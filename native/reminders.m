#import <Foundation/Foundation.h>
#import <EventKit/EventKit.h>
#include <node_api.h>
#include <stdatomic.h>
#include <pthread.h>

// Node-API keeps the bridge in the host application's permission identity.
static EKEventStore *eventStore;
static id changeObserver;
static napi_threadsafe_function changeCallback;
static _Atomic bool closing = false;
static pthread_mutex_t callbackMutex = PTHREAD_MUTEX_INITIALIZER;

static NSDictionary *Failure(NSString *code, NSString *message) {
    return @{ @"ok": @NO, @"error": @{ @"code": code, @"message": message ?: @"提醒事项操作失败" } };
}
static BOOL Authorized(void) {
    EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeReminder];
    if (@available(macOS 14.0, *)) return status == EKAuthorizationStatusFullAccess;
    return status == EKAuthorizationStatusAuthorized;
}
static NSString *Status(void) {
    if (Authorized()) return @"authorized";
    switch ([EKEventStore authorizationStatusForEntityType:EKEntityTypeReminder]) {
        case EKAuthorizationStatusNotDetermined: return @"notDetermined";
        case EKAuthorizationStatusRestricted: return @"restricted";
        case EKAuthorizationStatusDenied: return @"denied";
        default: return @"denied";
    }
}
static EKEventStore *Store(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        eventStore = [[EKEventStore alloc] init];
        changeObserver = [[NSNotificationCenter defaultCenter] addObserverForName:EKEventStoreChangedNotification object:eventStore queue:nil usingBlock:^(NSNotification *note) {
            pthread_mutex_lock(&callbackMutex);
            if (!atomic_load(&closing) && changeCallback) napi_call_threadsafe_function(changeCallback, NULL, napi_tsfn_nonblocking);
            pthread_mutex_unlock(&callbackMutex);
        }];
    });
    return eventStore;
}
static NSCalendar *Gregorian(void) {
    NSCalendar *calendar = [[NSCalendar alloc] initWithCalendarIdentifier:NSCalendarIdentifierGregorian];
    calendar.timeZone = [NSTimeZone localTimeZone];
    return calendar;
}
static NSDate *Due(EKReminder *r) {
    NSDateComponents *d = r.dueDateComponents;
    if (!d) return nil;
    NSCalendar *c = d.calendar ?: Gregorian();
    return [c dateFromComponents:d];
}
static NSString *Repeat(EKReminder *r) {
    NSArray *rules = r.recurrenceRules;
    if (!rules.count) return @"";
    EKRecurrenceRule *rule = rules.firstObject;
    BOOL simple = rules.count == 1 && rule.interval == 1 && !rule.recurrenceEnd &&
        !rule.daysOfTheMonth.count && !rule.monthsOfTheYear.count && !rule.weeksOfTheYear.count &&
        !rule.daysOfTheYear.count && !rule.setPositions.count;
    if (!simple) return @"custom";
    if (rule.frequency == EKRecurrenceFrequencyDaily && !rule.daysOfTheWeek.count) return @"daily";
    if (rule.frequency == EKRecurrenceFrequencyWeekly) {
        if (!rule.daysOfTheWeek.count) return @"weekly";
        EKRecurrenceDayOfWeek *day = rule.daysOfTheWeek.firstObject;
        NSDate *due = Due(r);
        if (rule.daysOfTheWeek.count == 1 && day.weekNumber == 0 && due && day.dayOfTheWeek == [Gregorian() component:NSCalendarUnitWeekday fromDate:due]) return @"weekly";
    }
    return @"custom";
}
static NSDictionary *EncodeReminder(EKReminder *r) {
    NSDate *due = Due(r);
    BOOL timed = r.dueDateComponents && r.dueDateComponents.hour != NSDateComponentUndefined;
    NSString *priority = r.priority && r.priority <= 4 ? @"urgent" : r.priority == 5 ? @"important" : @"normal";
    return @{ @"id": r.calendarItemIdentifier, @"externalId": r.calendarItemExternalIdentifier ?: @"",
        @"stamp": @([r.lastModifiedDate timeIntervalSince1970] * 1000),
        @"text": r.title ?: @"", @"note": r.notes ?: @"", @"url": r.URL.absoluteString ?: @"",
        @"date": @{ @"value": due ? @([due timeIntervalSince1970] * 1000) : (id)[NSNull null], @"hasTime": @(timed) },
        @"priority": priority, @"repeat": Repeat(r), @"done": @(r.completed) };
}
static NSDictionary *Perform(NSDictionary *input) {
    NSString *action = input[@"action"];
    if ([action isEqual:@"status"]) return @{ @"ok": @YES, @"result": @{ @"authorization": Status() } };
    EKEventStore *store = Store();
    if ([action isEqual:@"authorize"]) {
        if ([Status() isEqual:@"notDetermined"]) {
            dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
            dispatch_async(dispatch_get_main_queue(), ^{
                void (^completion)(BOOL, NSError *) = ^(BOOL granted, NSError *error) { dispatch_semaphore_signal(semaphore); };
                if (@available(macOS 14.0, *)) [store requestFullAccessToRemindersWithCompletion:completion];
                else [store requestAccessToEntityType:EKEntityTypeReminder completion:completion];
            });
            if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 180 * NSEC_PER_SEC))) return Failure(@"AUTH_TIMEOUT", @"授权尚未完成，请处理系统提示后重试。");
        }
        return @{ @"ok": @YES, @"result": @{ @"authorization": Status() } };
    }
    if (!Authorized()) return Failure(@"NOT_AUTHORIZED", @"同步未完成：尚未获得提醒事项权限。请在系统设置的“隐私与安全性 → 提醒事项”中开启不记Todo。");
    [store reset];
    if ([action isEqual:@"lists"]) {
        NSMutableArray *lists = [NSMutableArray array];
        for (EKCalendar *calendar in [store calendarsForEntityType:EKEntityTypeReminder]) {
            if (!calendar.allowsContentModifications) continue;
            NSString *source = calendar.source.title ?: @"";
            BOOL cloud = [source rangeOfString:@"icloud" options:NSCaseInsensitiveSearch].location != NSNotFound;
            [lists addObject:@{ @"id": calendar.calendarIdentifier, @"title": calendar.title ?: @"", @"source": source, @"iCloud": @(cloud) }];
        }
        return @{ @"ok": @YES, @"result": lists };
    }
    NSString *calendarId = input[@"calendarId"];
    EKCalendar *calendar = [calendarId isKindOfClass:NSString.class] ? [store calendarWithIdentifier:calendarId] : nil;
    if (!calendar || !(calendar.allowedEntityTypes & EKEntityMaskReminder) || !calendar.allowsContentModifications)
        return Failure(@"CALENDAR_MISSING", @"所选清单不可用或不允许修改，请重新选择清单。");
    if ([action isEqual:@"snapshot"]) {
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block NSArray *reminders;
        NSPredicate *predicate = [store predicateForIncompleteRemindersWithDueDateStarting:nil ending:nil calendars:@[calendar]];
        id token = [store fetchRemindersMatchingPredicate:predicate completion:^(NSArray<EKReminder *> *items) { reminders = items; dispatch_semaphore_signal(semaphore); }];
        if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC))) {
            [store cancelFetchRequest:token]; return Failure(@"READ_TIMEOUT", @"读取提醒事项超时，稍后会自动重试。");
        }
        if (!reminders) return Failure(@"READ_FAILED", @"未能读取提醒事项，原有数据未改动。");
        NSMutableDictionary *byId = [NSMutableDictionary dictionary];
        for (EKReminder *r in reminders) byId[r.calendarItemIdentifier] = EncodeReminder(r);
        NSMutableArray *outside = [NSMutableArray array];
        for (NSString *identifier in input[@"ids"] ?: @[]) {
            EKCalendarItem *item = [store calendarItemWithIdentifier:identifier];
            if (![item isKindOfClass:EKReminder.class]) continue;
            if (![item.calendar.calendarIdentifier isEqual:calendarId]) { [outside addObject:identifier]; continue; }
            byId[identifier] = EncodeReminder((EKReminder *)item);
        }
        return @{ @"ok": @YES, @"result": @{ @"reminders": byId.allValues, @"outsideIds": outside } };
    }
    if (![action isEqual:@"create"] && ![action isEqual:@"update"] && ![action isEqual:@"delete"]) return Failure(@"BAD_ACTION", @"不支持的操作。");
    EKReminder *reminder;
    BOOL creating = [action isEqual:@"create"];
    if (creating) { reminder = [EKReminder reminderWithEventStore:store]; reminder.calendar = calendar; }
    else {
        EKCalendarItem *item = [store calendarItemWithIdentifier:input[@"id"] ?: @""];
        if (![item isKindOfClass:EKReminder.class]) return Failure(@"ITEM_MISSING", @"任务已发生变化，请重新同步。");
        if (![item.calendar.calendarIdentifier isEqual:calendarId]) return Failure(@"ITEM_MOVED", @"任务已移出所选清单，未修改其他清单。");
        reminder = (EKReminder *)item;
        if (input[@"stamp"] && fabs([reminder.lastModifiedDate timeIntervalSince1970] * 1000 - [input[@"stamp"] doubleValue]) > 1)
            return Failure(@"ITEM_CHANGED", @"任务刚刚在另一端更新，请重新同步。");
    }
    NSError *error = nil;
    if ([action isEqual:@"delete"]) {
        if (![store removeReminder:reminder commit:YES error:&error]) return Failure(@"WRITE_FAILED", error.localizedDescription);
        return @{ @"ok": @YES, @"result": @{ @"deleted": @YES } };
    }
    NSDictionary *patch = input[@"patch"];
    if (![patch isKindOfClass:NSDictionary.class]) return Failure(@"BAD_INPUT", @"任务内容无效。");
    if (patch[@"text"]) {
        if (![patch[@"text"] isKindOfClass:NSString.class] || ![patch[@"text"] length]) return Failure(@"BAD_INPUT", @"任务正文不能为空。");
        reminder.title = patch[@"text"];
    }
    if (patch[@"note"]) reminder.notes = patch[@"note"];
    if (patch[@"priority"]) reminder.priority = [patch[@"priority"] isEqual:@"urgent"] ? 1 : [patch[@"priority"] isEqual:@"important"] ? 5 : 0;
    if (patch[@"date"]) {
        NSDictionary *date = patch[@"date"];
        NSDate *oldDue = Due(reminder);
        NSDate *newDue = date[@"value"] != [NSNull null] ? [NSDate dateWithTimeIntervalSince1970:[date[@"value"] doubleValue] / 1000] : nil;
        if (newDue) {
            NSCalendarUnit units = NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay;
            if ([date[@"hasTime"] boolValue]) units |= NSCalendarUnitHour | NSCalendarUnitMinute | NSCalendarUnitSecond;
            NSDateComponents *components = [Gregorian() components:units fromDate:newDue]; components.calendar = Gregorian();
            reminder.dueDateComponents = components;
            NSDate *start = reminder.startDateComponents ? [Gregorian() dateFromComponents:reminder.startDateComponents] : nil;
            if (!start || [start compare:newDue] == NSOrderedDescending) reminder.startDateComponents = components;
        } else reminder.dueDateComponents = nil;
        NSMutableArray *alarms = [NSMutableArray array];
        for (EKAlarm *alarm in reminder.alarms ?: @[]) {
            if (oldDue && alarm.absoluteDate && fabs([alarm.absoluteDate timeIntervalSinceDate:oldDue]) < 1) {
                if (newDue && [date[@"hasTime"] boolValue]) [alarms addObject:[EKAlarm alarmWithAbsoluteDate:newDue]];
            } else [alarms addObject:alarm];
        }
        if (newDue && [date[@"hasTime"] boolValue] && !alarms.count) [alarms addObject:[EKAlarm alarmWithAbsoluteDate:newDue]];
        reminder.alarms = alarms;
    }
    if (patch[@"repeat"] && ![patch[@"repeat"] isEqual:@"custom"]) {
        NSString *repeat = patch[@"repeat"];
        if (repeat.length && !reminder.dueDateComponents) return Failure(@"REPEAT_NEEDS_DATE", @"循环任务需要先设置日期。");
        reminder.recurrenceRules = repeat.length ? @[[[EKRecurrenceRule alloc] initRecurrenceWithFrequency:[repeat isEqual:@"daily"] ? EKRecurrenceFrequencyDaily : EKRecurrenceFrequencyWeekly interval:1 end:nil]] : @[];
    }
    if (patch[@"done"]) reminder.completed = [patch[@"done"] boolValue];
    if (![store saveReminder:reminder commit:YES error:&error]) return Failure(@"WRITE_FAILED", error.localizedDescription);
    return @{ @"ok": @YES, @"result": EncodeReminder(reminder) };
}

typedef struct { napi_deferred deferred; napi_async_work work; char *input; char *output; } Request;
static void Execute(napi_env env, void *data) {
    Request *request = data;
    @autoreleasepool {
        NSDictionary *result;
        @try {
            NSData *bytes = [[NSString stringWithUTF8String:request->input] dataUsingEncoding:NSUTF8StringEncoding];
            id input = [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
            // EventKit operations are serialized even when settings and background sync overlap.
            @synchronized (EKEventStore.class) { result = [input isKindOfClass:NSDictionary.class] ? Perform(input) : Failure(@"BAD_INPUT", @"请求无效。"); }
        } @catch (NSException *exception) { result = Failure(@"NATIVE_ERROR", @"苹果提醒事项暂时不可用，请稍后重试。"); }
        NSData *output = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
        request->output = strdup([[[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding] UTF8String]);
    }
}
static void Complete(napi_env env, napi_status status, void *data) {
    Request *request = data; napi_value output;
    napi_create_string_utf8(env, request->output ?: "{\"ok\":false,\"error\":{\"code\":\"CANCELLED\",\"message\":\"操作已取消\"}}", NAPI_AUTO_LENGTH, &output);
    napi_resolve_deferred(env, request->deferred, output);
    napi_delete_async_work(env, request->work); free(request->input); free(request->output); free(request);
}
static napi_value Call(napi_env env, napi_callback_info info) {
    size_t count = 1, length = 0; napi_value argument, promise, name;
    napi_get_cb_info(env, info, &count, &argument, NULL, NULL);
    if (count != 1 || napi_get_value_string_utf8(env, argument, NULL, 0, &length) != napi_ok || length > 2 * 1024 * 1024) {
        napi_throw_type_error(env, NULL, "Expected a JSON request string"); return NULL;
    }
    Request *request = calloc(1, sizeof(Request)); request->input = calloc(length + 1, 1);
    napi_get_value_string_utf8(env, argument, request->input, length + 1, &length);
    napi_create_promise(env, &request->deferred, &promise);
    napi_create_string_utf8(env, "AppleReminders", NAPI_AUTO_LENGTH, &name);
    napi_create_async_work(env, NULL, name, Execute, Complete, request, &request->work);
    napi_queue_async_work(env, request->work); return promise;
}
static void Changed(napi_env env, napi_value callback, void *context, void *data) {
    if (!env || !callback) return;
    napi_value receiver, result; napi_get_undefined(env, &receiver); napi_call_function(env, receiver, callback, 0, NULL, &result);
}
static napi_value OnChange(napi_env env, napi_callback_info info) {
    size_t count = 1; napi_value callback, name, result;
    napi_get_cb_info(env, info, &count, &callback, NULL, NULL);
    if (!changeCallback && count == 1) {
        napi_create_string_utf8(env, "RemindersChanged", NAPI_AUTO_LENGTH, &name);
        napi_create_threadsafe_function(env, callback, NULL, name, 1, 1, NULL, NULL, NULL, Changed, &changeCallback);
        napi_unref_threadsafe_function(env, changeCallback);
    }
    napi_get_undefined(env, &result); return result;
}
static void Cleanup(void *data) {
    pthread_mutex_lock(&callbackMutex);
    atomic_store(&closing, true);
    if (changeObserver) [[NSNotificationCenter defaultCenter] removeObserver:changeObserver];
    if (changeCallback) napi_release_threadsafe_function(changeCallback, napi_tsfn_abort);
    changeCallback = NULL;
    pthread_mutex_unlock(&callbackMutex);
}
NAPI_MODULE_INIT() {
    napi_property_descriptor properties[] = {
        { "request", NULL, Call, NULL, NULL, NULL, napi_default, NULL },
        { "onChange", NULL, OnChange, NULL, NULL, NULL, napi_default, NULL }
    };
    napi_define_properties(env, exports, 2, properties); napi_add_env_cleanup_hook(env, Cleanup, NULL); return exports;
}

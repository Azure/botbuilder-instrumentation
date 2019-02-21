"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const util = require("util");
const _ = require("lodash");
const ai = require("botbuilder-ai");
const core = require("botbuilder-core");
const request = require("request");
const ApplicationInsights = require("applicationinsights");
const events_1 = require("./events");
class BotFrameworkInstrumentation {
    constructor(settings) {
        this.appInsightsClients = [];
        this.console = {};
        this.methods = {
            "debug": 0,
            "info": 1,
            "log": 2,
            "warn": 3,
            "error": 4
        };
        /**
         * This is a list of custom fields that will be pushed with the logging of each event
         */
        this.customFields = null;
        this.instrumentationKeys = [];
        this.sentiments = {};
        this.settings = {};
        this.initSentimentData();
        this.settings = settings || {};
        this.customFields = this.settings.customFields || null;
        _.extend(this.sentiments, this.settings.sentiments);
        this.sentiments.key = this.sentiments.key || process.env.CG_SENTIMENT_KEY;
        if (this.settings.instrumentationKey) {
            this.instrumentationKeys =
                Array.isArray(this.settings.instrumentationKey) ?
                    this.settings.instrumentationKey :
                    [this.settings.instrumentationKey];
        }
        else {
            if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY) {
                this.instrumentationKeys = [process.env.APPINSIGHTS_INSTRUMENTATIONKEY];
            }
        }
        if (!this.instrumentationKeys) {
            throw new Error('App Insights instrumentation key was not provided in options or the environment variable APPINSIGHTS_INSTRUMENTATIONKEY');
        }
        if (!this.sentiments.key) {
            console.warn('No sentiment key was provided - text sentiments will not be collected');
        }
        this.appInsightsClients = [];
    }
    initSentimentData() {
        this.sentiments = {
            minWords: 3,
            url: 'https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment',
            id: 'bot-analytics',
            key: null
        };
    }
    formatArgs(args) {
        return util.format.apply(util.format, Array.prototype.slice.call(args));
    }
    setupConsoleCollection() {
        // Overriding console methods so that prints to console will first be logged
        // to application insights
        _.keys(this.methods).forEach(method => {
            console[method] = (() => {
                let original = console.log;
                return (...args) => {
                    let stdout = null;
                    try {
                        let msg = this.formatArgs(args);
                        this.logTrace(null, msg, this.methods[method]);
                        stdout = process.stdout;
                        process.stdout = process.stderr;
                        original.apply(console, args);
                    }
                    finally {
                        process.stdout = stdout || process.stdout;
                    }
                };
            })();
        });
    }
    collectSentiment(context, text) {
        text = text || '';
        if (!this.sentiments.key)
            return;
        if (text.match(/\S+/g).length < this.sentiments.minWords)
            return;
        request({
            url: this.sentiments.url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': this.sentiments.key
            },
            json: true,
            body: {
                "documents": [
                    {
                        "language": "en",
                        "id": this.sentiments.id,
                        "text": text
                    }
                ]
            }
        }, (error, response, body) => {
            if (error) {
                return this.logException(context, error);
            }
            try {
                let result = _.find(body.documents, { id: this.sentiments.id }) || {};
                var score = result.score || null;
                if (isNaN(score)) {
                    throw new Error('Could not collect sentiment');
                }
                var item = { text: text, score: score };
                this.logEvent(context, events_1.default.Sentiment.name, item);
            }
            catch (error) {
                return this.logException(context, error);
            }
        });
    }
    setupInstrumentation() {
        if (this.instrumentationKeys && this.instrumentationKeys.length > 0) {
            //we are setting the automatic updates to the first instumentation key.
            let autoCollectOptions = this.settings && this.settings.autoLogOptions || {};
            ApplicationInsights.setup(this.instrumentationKeys[0])
                .setAutoCollectConsole(autoCollectOptions.autoCollectConsole || false)
                .setAutoCollectExceptions(autoCollectOptions.autoCollectExceptions || false)
                .setAutoCollectRequests(autoCollectOptions.autoCollectRequests || false)
                .setAutoCollectPerformance(autoCollectOptions.autoCollectPerf || false)
                .start();
            //for all other custom events, traces etc, we are initiazling application insight clients accordignly.
            this.appInsightsClients = [];
            let self = this;
            _.forEach(this.instrumentationKeys, (iKey) => {
                let client = ApplicationInsights.getClient(iKey);
                self.appInsightsClients.push(client);
            });
        }
    }
    monitor(adapter) {
        this.setupInstrumentation();
        // Adding middleware to intercept all user messages
        if (adapter) {
            adapter.use({
                onTurn: (context, next) => __awaiter(this, void 0, void 0, function* () {
                    // User message
                    if (context.activity.type == core.ActivityTypes.Message) {
                        const activity = context.activity;
                        const item = {
                            text: activity.text,
                            type: activity.type
                        };
                        this.logEvent(context, events_1.default.UserMessage.name, item);
                        // this could potentially become async
                        this.collectSentiment(context, activity.text);
                    }
                    context.onSendActivities(this.onOutboundActivities.bind(this));
                    context.onUpdateActivity((c, a, n) => this.onOutboundActivities(c, [a], n));
                    return next();
                })
            });
        }
    }
    onOutboundActivities(context, activities, next) {
        return __awaiter(this, void 0, void 0, function* () {
            // Deliver activities
            yield next();
            yield Promise.all(activities.map((activity) => __awaiter(this, void 0, void 0, function* () {
                // Bot message
                if (activity.type == "message") {
                    const item = {
                        text: activity.text,
                        type: activity.type
                    };
                    yield this.logEvent(context, events_1.default.BotMessage.name, item);
                }
                // LUIS recognizer trace
                else if ((activity.type == core.ActivityTypes.Trace) &&
                    (activity.name == 'LuisRecognizer')) {
                    // Collect intents collected from LUIS after entities were resolved
                    const recognizerResult = activity.value.recognizerResult;
                    const topIntent = ai.LuisRecognizer.topIntent(recognizerResult);
                    const result = topIntent !== 'None' ? recognizerResult.intents[topIntent] : null;
                    let item = {
                        text: context.activity.text,
                        intent: topIntent,
                        score: result && result.score,
                    };
                    //there is no point sending 0 score intents to the telemetry.
                    if (item.score > 0) {
                        this.logEvent(context, events_1.default.Intent.name, item);
                    }
                    // Tracking entities for the event
                    if (result && result.entities) {
                        result.entities.forEach(value => {
                            let entityItem = _.clone(item);
                            entityItem.entityType = value.type;
                            entityItem.entityValue = value.entity;
                            this.logEvent(context, events_1.default.Entity.name, entityItem);
                        });
                    }
                }
            })));
        });
    }
    startTransaction(context, name = '') {
        let item = {
            name: name
        };
        this.logEvent(context, events_1.default.StartTransaction.name, item);
    }
    endTransaction(context, name = '', successful = true) {
        let item = {
            name: name,
            successful: successful.toString()
        };
        this.logEvent(context, events_1.default.EndTransaction.name, item);
    }
    /**
     * Logs QNA maker service data
     */
    trackQNAEvent(context, userQuery, kbQuestion, kbAnswer, score) {
        let item = {
            score: score,
            userQuery: userQuery,
            kbQuestion: kbQuestion,
            kbAnswer: kbAnswer
        };
        this.logEvent(context, events_1.default.QnaEvent.name, item);
    }
    trackCustomEvent(eventName, customProperties, context = null) {
        const logEventName = eventName || events_1.default.CustomEvent.name;
        this.logEvent(context, logEventName, customProperties);
    }
    trackEvent(customProperties, context = null) {
        this.trackCustomEvent(null, customProperties, context);
    }
    trackGoalTriggeredEvent(goalName, customProperties, context) {
        customProperties = customProperties || {};
        customProperties['GoalName'] = goalName;
        this.logEvent(context, events_1.default.GoalTriggeredEvent.name, customProperties);
    }
    getLogProperties(context, properties) {
        if (context == null) {
            return properties || null;
        }
        const activity = context.activity;
        const user = activity.from.role === 'user' ? activity.from : activity.recipient;
        let item = {
            timestamp: activity.timestamp,
            channel: activity.channelId,
            conversationId: activity.conversation.id,
            userId: user.id
        };
        if (!this.settings.omitUserName) {
            item.userName = user.name;
        }
        // Adding custom fields if supplied in the constructor settings
        if (this.customFields) {
            this.customFields.forEach(({ store, properties = [] }) => {
                let state = store.get(context);
                properties.forEach(property => {
                    if (Array.isArray(property)) {
                        item[property[property.length - 1]] = _.get(state, property, null);
                    }
                    else
                        item[property] = state[property] || null;
                });
            });
        }
        return Object.assign(item, properties);
    }
    /**
     * Log a user action or other occurrence.
     * @param name              A string to identify this event in the portal.
     * @param properties        map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
     */
    logEvent(context, name, properties) {
        let logProperties = this.getLogProperties(context, properties);
        console.log('logEvent', logProperties);
        this.appInsightsClients.forEach(client => client.trackEvent(name, logProperties));
    }
    /**
     * Log a trace message
     * @param message        A string to identify this event in the portal.
     * @param properties     map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
     */
    logTrace(context, message, severityLevel, properties) {
        let logProperties = this.getLogProperties(context, properties);
        this.appInsightsClients.forEach(client => client.trackTrace(message, severityLevel, logProperties));
    }
    /**
     * Log an exception you have caught.
     * @param   exception   An Error from a catch clause, or the string error message.
     * @param   properties  map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
     */
    logException(context, exception, properties) {
        let logProperties = this.getLogProperties(context, properties);
        this.appInsightsClients.forEach(client => client.trackException(exception, logProperties));
    }
}
exports.BotFrameworkInstrumentation = BotFrameworkInstrumentation;

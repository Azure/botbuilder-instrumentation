"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util = require("util");
const _ = require("lodash");
const builder = require("botbuilder");
const request = require("request");
const ApplicationInsights = require("applicationinsights");
const events_1 = require("./events");
const PROPERTY_BAGS = ['userData', 'conversationData', 'privateConversationData', 'dialogData'];
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
    collectSentiment(session, text) {
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
                return this.logException(session, error);
            }
            try {
                let result = _.find(body.documents, { id: this.sentiments.id }) || {};
                var score = result.score || null;
                if (isNaN(score)) {
                    throw new Error('Could not collect sentiment');
                }
                var item = { text: text, score: score };
                this.logEvent(session, events_1.default.Sentiment.name, item);
            }
            catch (error) {
                return this.logException(session, error);
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
    monitor(bot, recognizer) {
        this.setupInstrumentation();
        // Adding middleware to intercept all user messages
        if (bot) {
            bot.use({
                botbuilder: (session, next) => {
                    try {
                        let message = session.message;
                        let item = {
                            text: message.text,
                            type: message.type
                        };
                        this.logEvent(session, events_1.default.UserMessage.name, item);
                        self.collectSentiment(session, message.text);
                    }
                    catch (e) {
                    }
                    finally {
                        next();
                    }
                },
                send: (message, next) => {
                    try {
                        if (message.type == "message") {
                            let item = {
                                text: message.text,
                                type: message.type
                            };
                            this.logEvent(message, events_1.default.BotMessage.name, item);
                        }
                    }
                    catch (e) {
                    }
                    finally {
                        next();
                    }
                }
            });
        }
        // Collect intents collected from LUIS after entities were resolved
        let self = this;
        if (!recognizer) {
            builder.IntentDialog.prototype.recognize = (() => {
                let _recognize = builder.IntentDialog.prototype.recognize;
                return function (session, cb) {
                    let _dialog = this;
                    _recognize.apply(_dialog, [session, (err, result) => {
                            let message = session.message;
                            let item = {
                                text: message.text,
                                intent: result && result.intent,
                                score: result && result.score,
                                withError: !err,
                                error: err
                            };
                            //there is no point sending 0 score intents to the telemetry.
                            if (item.score > 0) {
                                self.logEvent(session, events_1.default.Intent.name, item);
                            }
                            // Tracking entities for the event
                            if (result && result.entities) {
                                result.entities.forEach(value => {
                                    let entityItem = _.clone(item);
                                    entityItem.entityType = value.type;
                                    entityItem.entityValue = value.entity;
                                    self.logEvent(session, events_1.default.Entity.name, entityItem);
                                });
                            }
                            // Todo: on "set alarm" utterence, failiure
                            return cb(err, result);
                        }]);
                };
            })();
        }
        else {
            recognizer.recognize = (() => {
                let _recognize = recognizer.recognize;
                return function (session, cb) {
                    let _self = this;
                    _recognize.apply(_self, [session, (err, result) => {
                            let message = session.message;
                            let item = {
                                text: message.text,
                                intent: result && result.intent,
                                score: result && result.score,
                                withError: !err,
                                error: err
                            };
                            //there is no point sending 0 score intents to the telemetry.
                            if (item.score > 0) {
                                self.logEvent(session, events_1.default.Intent.name, item);
                            }
                            // Tracking entities for the event
                            if (result && result.entities) {
                                result.entities.forEach(value => {
                                    let entityItem = _.clone(item);
                                    entityItem.entityType = value.type;
                                    entityItem.entityValue = value.entity;
                                    self.logEvent(session, events_1.default.Entity.name, entityItem);
                                });
                            }
                            // Todo: on "set alarm" utterence, failiure
                            return cb(err, result);
                        }]);
                };
            })();
        }
    }
    startTransaction(session, name = '') {
        let item = {
            name: name
        };
        this.logEvent(session, events_1.default.StartTransaction.name, item);
    }
    endTransaction(session, name = '', successful = true) {
        let item = {
            name: name,
            successful: successful.toString()
        };
        this.logEvent(session, events_1.default.EndTransaction.name, item);
    }
    /**
     * Logs QNA maker service data
     */
    trackQNAEvent(session, userQuery, kbQuestion, kbAnswer, score) {
        let item = {
            score: score,
            userQuery: userQuery,
            kbQuestion: kbQuestion,
            kbAnswer: kbAnswer
        };
        this.logEvent(session, events_1.default.QnaEvent.name, item);
    }
    trackCustomEvent(eventName, customProperties, session = null) {
        const logEventName = eventName || events_1.default.CustomEvent.name;
        this.logEvent(session, logEventName, customProperties);
    }
    trackEvent(customProperties, session = null) {
        this.trackCustomEvent(null, customProperties, session);
    }
    trackGoalTriggeredEvent(goalName, customProperties, session) {
        customProperties = customProperties || {};
        customProperties['GoalName'] = goalName;
        this.logEvent(session, events_1.default.GoalTriggeredEvent.name, customProperties);
    }
    getLogProperties(session, properties) {
        if (session == null) {
            return properties || null;
        }
        let message = {};
        let isSession = false;
        // Checking if the received object is a session or a message
        if (session.message) {
            isSession = true;
            message = session.message;
        }
        else {
            message = session;
        }
        let address = message.address || {};
        let conversation = address.conversation || {};
        let user = address.user || {};
        let item = {
            timestamp: message.timestamp,
            channel: address.channelId,
            conversationId: conversation.id,
            userId: user.id
        };
        if (!this.settings.omitUserName) {
            item.userName = user.name;
        }
        // Adding custom fields if supplied in the constructor settings
        if (isSession && this.customFields) {
            PROPERTY_BAGS.forEach(propertyBag => {
                let properties = this.customFields[propertyBag] || [];
                properties.forEach(property => {
                    if (Array.isArray(property)) {
                        item[property[property.length - 1]] = _.get(session, [propertyBag, ...property], null);
                    }
                    else
                        item[property] = session[propertyBag][property] || null;
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
    logEvent(session, name, properties) {
        let logProperties = this.getLogProperties(session, properties);
        this.appInsightsClients.forEach(client => client.trackEvent(name, logProperties));
    }
    /**
     * Log a trace message
     * @param message        A string to identify this event in the portal.
     * @param properties     map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
     */
    logTrace(session, message, severityLevel, properties) {
        let logProperties = this.getLogProperties(session, properties);
        this.appInsightsClients.forEach(client => client.trackTrace(message, severityLevel, logProperties));
    }
    /**
     * Log an exception you have caught.
     * @param   exception   An Error from a catch clause, or the string error message.
     * @param   properties  map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
     */
    logException(session, exception, properties) {
        let logProperties = this.getLogProperties(session, properties);
        this.appInsightsClients.forEach(client => client.trackException(exception, logProperties));
    }
}
exports.BotFrameworkInstrumentation = BotFrameworkInstrumentation;

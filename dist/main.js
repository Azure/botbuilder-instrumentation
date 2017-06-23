"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util = require("util");
const _ = require("lodash");
const builder = require("botbuilder");
const request = require("request");
const ApplicationInsights = require("applicationinsights");
const events_1 = require("./events");
const CURRENT_BOT_NAME = "currentBotName";
const DefaultBotName = "*";
function setCurrentBotName(session, botName) {
    session.privateConversationData[CURRENT_BOT_NAME] = botName;
    return session;
}
exports.setCurrentBotName = setCurrentBotName;
class BotFrameworkInstrumentation {
    constructor(settings) {
        this.settings = settings;
        this.currentBotName = DefaultBotName;
        this.console = {};
        this.methods = {
            "debug": 0,
            "info": 1,
            "log": 2,
            "warn": 3,
            "error": 4
        };
        this.customFields = {
            containerKeys: {},
            containers: {},
            objects: {}
        };
        this.sentiments = {
            minWords: 3,
            url: 'https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment',
            id: 'bot-analytics',
            key: null
        };
        settings = settings || null;
        _.extend(this.sentiments, settings.sentiments);
        this.sentiments.key = (this.sentiments.hasOwnProperty('key')) ? this.sentiments.key : process.env.CG_SENTIMENT_KEY;
        this.instrumentationKey = settings.instrumentationKey || process.env.APPINSIGHTS_INSTRUMENTATIONKEY;
        if (!this.instrumentationKey) {
            throw new Error('App Insights instrumentation key was not provided in options or the environment variable APPINSIGHTS_INSTRUMENTATIONKEY');
        }
        if (!this.sentiments.key) {
            console.warn('No sentiment key was provided - text sentiments will not be collected');
        }
    }
    formatArgs(args) {
        return util.format.apply(util.format, Array.prototype.slice.call(args));
    }
    setupConsoleCollection() {
        _.keys(this.methods).forEach(method => {
            console[method] = (() => {
                let original = console.log;
                return (...args) => {
                    let stdout;
                    try {
                        let msg = this.formatArgs(args);
                        this.trackTrace(msg, this.methods[method]);
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
        if (!this.sentiments.key)
            return;
        if (text.match(/\S+/g).length < this.sentiments.minWords)
            return;
        let message = session.message;
        let timestamp = message.timestamp;
        let address = message.address || null;
        let conversation = address.conversation || null;
        let user = address.user || null;
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
                return this.trackException(error);
            }
            try {
                let result = _.find(body.documents, { id: this.sentiments.id }) || {};
                var score = result.score || null;
                if (isNaN(score)) {
                    throw new Error('Could not collect sentiment');
                }
                var item = {
                    text: text,
                    score: score,
                    timestamp: timestamp,
                    channel: address.channelId,
                    conversationId: conversation.id,
                    userId: user.id,
                    userName: user.name
                };
                this.trackEvent(events_1.default.Sentiment.name, item);
            }
            catch (error) {
                return this.trackException(error);
            }
        });
    }
    updateProps(props, customFields) {
        if (!customFields) {
            customFields = {};
            for (var key in this.customFields.objects) {
                _.extend(customFields, this.customFields.objects[key]);
            }
            for (var key in this.customFields.containerKeys) {
                if (this.customFields.containerKeys.hasOwnProperty(key)) {
                    let container = this.customFields.containers[key];
                    let values = this.customFields.containerKeys[key];
                    for (let key of values) {
                        customFields[key] = (container.hasOwnProperty(key)) ? container[key] : `VALUE-FOR-KEY:'${key}'-NOT-FOUND`;
                    }
                }
            }
        }
        _.extend(props, customFields);
        return props;
    }
    getBotName(session) {
        let name = (session.privateConversationData.hasOwnProperty(CURRENT_BOT_NAME)) ? session.privateConversationData[CURRENT_BOT_NAME] : DefaultBotName;
        if (name === DefaultBotName && session.library) {
            name = (session.library.hasOwnProperty("name")) ? session.library.name : DefaultBotName;
        }
        return name;
    }
    prepProps(session) {
        let message = session.message;
        let address = message.address || null;
        let conversation = address.conversation || null;
        let user = address.user || null;
        this.currentBotName = this.getBotName(session);
        let item = {
            text: message.text,
            type: message.type,
            timestamp: message.timestamp,
            conversationId: conversation.id,
            channel: address.channelId,
            userId: user.id,
            userName: user.name,
            locale: session.preferredLocale(),
            botName: this.currentBotName
        };
        console.log("\nBOTNAME: ", item.botName, "\n");
        return this.updateProps(item);
    }
    setupInstrumentation(autoCollectConsole = false, autoCollectExceptions = false, autoCollectRequests = false, autoCollectPerf = false) {
        ApplicationInsights.setup(this.instrumentationKey)
            .setAutoCollectConsole(autoCollectConsole)
            .setAutoCollectExceptions(autoCollectExceptions)
            .setAutoCollectRequests(autoCollectRequests)
            .setAutoCollectPerformance(autoCollectPerf)
            .start();
        this.appInsightsClient = ApplicationInsights.getClient(this.instrumentationKey);
    }
    monitor(bot) {
        this.setupInstrumentation(this.settings.autoLogOptions.autoCollectConsole, this.settings.autoLogOptions.autoCollectExceptions, this.settings.autoLogOptions.autoCollectRequests, this.settings.autoLogOptions.autoCollectPerf);
        if (bot) {
            this.currentBotName = bot.name;
            bot.use({
                botbuilder: (session, next) => {
                    try {
                        let item = this.prepProps(session);
                        this.trackEvent(events_1.default.UserMessage.name, item);
                        self.collectSentiment(session, session.message.text);
                    }
                    catch (e) {
                    }
                    finally {
                        next();
                    }
                },
                send: (message, next) => {
                    try {
                        let address = message.address || null;
                        let conversation = address.conversation || null;
                        let user = address.user || null;
                        let item = {
                            text: message.text,
                            type: message.type,
                            timestamp: message.timestamp,
                            conversationId: conversation.id,
                            botName: this.currentBotName
                        };
                        this.updateProps(item);
                        this.trackEvent(events_1.default.BotMessage.name, item);
                    }
                    catch (e) {
                    }
                    finally {
                        next();
                    }
                }
            });
        }
        let self = this;
        builder.IntentDialog.prototype.recognize = (() => {
            let _recognize = builder.IntentDialog.prototype.recognize;
            return function (session, cb) {
                let _dialog = this;
                _recognize.apply(_dialog, [session, (err, result) => {
                        let message = session.message;
                        let address = message.address || null;
                        let conversation = address.conversation || null;
                        let user = address.user || null;
                        let item = {
                            text: message.text,
                            timestamp: message.timestamp,
                            intent: result && result.intent,
                            channel: address.channelId,
                            score: result && result.score,
                            withError: !err,
                            error: err,
                            conversationId: conversation.id,
                            userId: user.id,
                            userName: user.name
                        };
                        if (item.score > 0) {
                            self.trackEvent(events_1.default.Intent.name, item);
                        }
                        if (result && result.entities) {
                            result.entities.forEach(value => {
                                let entityItem = _.clone(item);
                                entityItem.entityType = value.type;
                                entityItem.entityValue = value.entity;
                                self.trackEvent(events_1.default.Entity.name, entityItem);
                            });
                        }
                        return cb(err, result);
                    }]);
            };
        })();
    }
    setCustomFields(objectContainer, keys) {
        if (keys) {
            let index = Object.values(this.customFields.containers).indexOf(objectContainer);
            let keyValues = Array.isArray(keys) ? keys : [keys];
            if (index == -1) {
                let idx = (Object.keys(this.customFields.containers).length - 1) <= -1 ? 0 : Object.keys(this.customFields.containers).length - 1;
                this.customFields.containers[idx] = objectContainer;
                this.customFields.containerKeys[idx] = keyValues;
            }
            else {
                for (let key of keyValues) {
                    if (!this.customFields.containerKeys[index].includes(key)) {
                        this.customFields.containerKeys[index].push(key);
                    }
                }
            }
        }
        else {
            let index = Object.values(this.customFields.objects).indexOf(objectContainer);
            if (index == -1) {
                let idx = (Object.keys(this.customFields.objects).length - 1) <= -1 ? 0 : Object.keys(this.customFields.objects).length - 1;
                this.customFields.objects[idx] = objectContainer;
            }
        }
    }
    startTransaction(session, name = '') {
        let message = session.message;
        let address = message.address || null;
        let conversation = address.conversation || null;
        let user = address.user || null;
        let item = {
            name: name,
            timestamp: message.timestamp,
            channel: address.channelId,
            conversationId: conversation.id,
            userId: user.id,
            userName: user.name
        };
        this.trackEvent(events_1.default.StartTransaction.name, item);
    }
    endTransaction(session, name = '', successful = true) {
        let message = session.message;
        let address = message.address || null;
        let conversation = address.conversation || null;
        let user = address.user || null;
        let item = {
            name: name,
            successful: successful.toString(),
            timestamp: message.timestamp,
            channel: address.channelId,
            conversationId: conversation.id,
            userId: user.id,
            userName: user.name
        };
        this.trackEvent(events_1.default.EndTransaction.name, item);
    }
    prepareLogData(session, item) {
        let props = this.prepProps(session);
        props = this.updateProps(props, item);
        return props;
    }
    logCustomEvent(eventName, session, properties) {
        properties["eventName"] = eventName;
        this.trackEvent(events_1.default.CustomEvent.name, this.prepareLogData(session, properties));
    }
    logCustomError(error, session, properties) {
        this.trackException(error, this.prepareLogData(session, properties));
    }
    logQNAEvent(userQuery, session, kbQuestion, kbAnswer, score) {
        let message = session.message;
        let address = message.address || null;
        let conversation = address.conversation || null;
        let user = address.user || null;
        let item = {
            score: score,
            timestamp: message.timestamp,
            channel: address.channelId,
            conversationId: conversation.id,
            userId: user.id,
            userName: user.name,
            userQuery: userQuery,
            kbQuestion: kbQuestion,
            kbAnswer: kbAnswer
        };
        item = this.updateProps(item);
        this.trackEvent(events_1.default.QnaEvent.name, this.prepareLogData(session, item));
    }
    trackEvent(name, properties, measurements, tagOverrides, contextObjects) {
        console.log("\nTRACK EVENT -------\nCLIENT: ", this.instrumentationKey, "\nEVENT: ", name, "\nPROPS: ", JSON.stringify(properties, null, 2), "\nTRACK EVENT -------\n");
        this.appInsightsClient.trackEvent(name, properties, measurements, tagOverrides, contextObjects);
    }
    trackTrace(message, severityLevel, properties, tagOverrides, contextObjects) {
        console.log("\nTRACK TRACE -------\nCLIENT: ", this.instrumentationKey, "\nEVENT: ", message, "\nSEC-LEVEL: ", severityLevel, "\nPROPS: ", JSON.stringify(properties, null, 2), "\nTRACK TRACE -------\n");
        this.appInsightsClient.trackTrace(message, severityLevel, properties, tagOverrides, contextObjects);
    }
    trackException(exception, properties, measurements, tagOverrides, contextObjects) {
        console.log("\nTRACK EXCEPTION -------\nCLIENT: ", this.instrumentationKey, "\nEVENT: ", exception, "\nEXCEPTION: ", exception, "\nPROPS: ", JSON.stringify(properties, null, 2), "\nTRACK EXCEPTION -------\n");
        this.appInsightsClient.trackException(exception, properties, measurements, tagOverrides, contextObjects);
    }
}
exports.BotFrameworkInstrumentation = BotFrameworkInstrumentation;
//# sourceMappingURL=/Users/claudius/Documents/workspace/Bots/botbuilder-instrumentation/dist/main.js.map
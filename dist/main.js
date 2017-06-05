"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util = require("util");
const _ = require("lodash");
const builder = require("botbuilder");
const request = require("request");
const ApplicationInsights = require("applicationinsights");
const events_1 = require("./events");
class BotFrameworkInstrumentation {
    constructor(settings) {
        this.appInsightsClient = ApplicationInsights.client;
        this.console = {};
        this.methods = {
            "debug": 0,
            "info": 1,
            "log": 2,
            "warn": 3,
            "error": 4
        };
        this.settings = {
            sentiments: {
                minWords: 3,
                url: 'https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment',
                id: 'bot-analytics',
                key: null
            }
        };
        settings = settings || {};
        _.extend(this.settings.sentiments, settings.sentiments);
        this.settings.sentiments.key = this.settings.sentiments.key || process.env.CG_SENTIMENT_KEY;
        this.settings.instrumentationKey = settings.instrumentationKey || process.env.APPINSIGHTS_INSTRUMENTATIONKEY;
        if (!this.settings.instrumentationKey) {
            throw new Error('App Insights instrumentation key was not provided in options or the environment variable APPINSIGHTS_INSTRUMENTATIONKEY');
        }
        if (!this.settings.sentiments.key) {
            console.warn('No sentiment key was provided - text sentiments will not be collected');
        }
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
                        this.appInsightsClient.trackTrace(msg, this.methods[method]);
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
        if (!this.settings.sentiments.key)
            return;
        if (text.match(/\S+/g).length < this.settings.sentiments.minWords)
            return;
        let message = session.message || {};
        let timestamp = message.timestamp;
        let address = message.address || {};
        let conversation = address.conversation || {};
        let user = address.user || {};
        request({
            url: this.settings.sentiments.url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': this.settings.sentiments.key
            },
            json: true,
            body: {
                "documents": [
                    {
                        "language": "en",
                        "id": this.settings.sentiments.id,
                        "text": text
                    }
                ]
            }
        }, (error, response, body) => {
            if (error) {
                return this.appInsightsClient.trackException(error);
            }
            try {
                let result = _.find(body.documents, { id: this.settings.sentiments.id }) || {};
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
                this.appInsightsClient.trackEvent(events_1.default.Sentiment.name, item);
            }
            catch (error) {
                return this.appInsightsClient.trackException(error);
            }
        });
    }
    monitor(bot) {
        ApplicationInsights.setup(this.settings.instrumentationKey)
            .setAutoCollectConsole(true)
            .setAutoCollectExceptions(true)
            .setAutoCollectRequests(true)
            .start();
        this.appInsightsClient = ApplicationInsights.getClient(this.settings.instrumentationKey);
        //this.setupConsoleCollection();
        // Adding middleware to intercept all user messages
        if (bot) {
            bot.use({
                botbuilder: (session, next) => {
                    try {
                        let message = session.message;
                        let address = message.address || {};
                        let conversation = address.conversation || {};
                        let user = address.user || {};
                        let item = {
                            text: message.text,
                            type: message.type,
                            timestamp: message.timestamp,
                            conversationId: conversation.id,
                            channel: address.channelId,
                            userId: user.id,
                            userName: user.name
                        };
                        this.appInsightsClient.trackEvent(events_1.default.UserMessage.name, item);
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
                            let address = message.address || {};
                            let conversation = address.conversation || {};
                            let user = address.user || {};
                            let item = {
                                text: message.text,
                                type: message.type,
                                timestamp: message.timestamp,
                                conversationId: conversation.id
                            };
                            this.appInsightsClient.trackEvent(events_1.default.BotMessage.name, item);
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
        // Monitoring new dialog calls like session.beginDialog
        // When beginning a new dialog, the framework uses pushDialog to change context 
        // to a new dialog
        // Todo: Check alternative as <builder.SimpleDialog.prototype.begin>
        // builder.Session.prototype..pushDialog = (function() {
        //   var orig = builder.Session.prototype.pushDialog;
        //   return function (args) {
        //     var _session = this;
        //     var _message = _session.message || {};
        //     var _address = _message.address || {};
        //     var _conversation = _address.conversation || {};
        //     var _user = _address.user || {};
        //     var _callstack = _session.sessionState.callstack;
        //     var item = { 
        //       intent: args && args.id,
        //       state: args && args.state && JSON.stringify(args.state),
        //       channel: _address.channelId,
        //       conversationId: _conversation.id,
        //       callstack_length: _callstack.length.toString(),
        //       userId: _user.id,
        //       userName: _user.name
        //     };
        //     _.take(_callstack, 3).forEach((stackItem: any, idx: number) => {
        //       item[`callstack_${idx}_id`] = stackItem.id;
        //       item[`callstack_${idx}_state`] = JSON.stringify(stackItem.state);
        //     });
        //     this.appInsightsClient.trackEvent(Events.Intents.name, item);
        //     orig.apply(_session, [args]);
        //   }
        // })();
        // Capture message session before send
        // builder.Session.prototype.prepareMessage = (function() {
        //   var orig = builder.Session.prototype.prepareMessage;
        //   return function (msg) {
        //     var _session = this;
        //     var res = orig.apply(_session, [msg]);
        //     if (_session.dialogData['transaction.started']) { 
        //       var transactionEnded = false;
        //       var success = false;
        //       var conversation = _.find(transactions, { intent: _session.dialogData['transaction.id'] });
        //       if (conversation.intent != _session.dialogData['BotBuilder.Data.Intent']) {
        //         transactionEnded = true;
        //       } else {
        //         var test = conversation.test;
        //         var success = typeof test == 'string' ? test == msg.text : test.test(msg.text);
        //         if (success) {
        //           transactionEnded = true;
        //         }
        //       }
        //       if (transactionEnded) {
        //         endConverting(_session, null, success);
        //         delete _session.dialogData['transaction.started'];
        //         delete _session.dialogData['transaction.id'];
        //       }
        //     }
        //     return res;
        //   }
        // })();
        // Collect intents collected from LUIS after entities were resolved
        let self = this;
        builder.IntentDialog.prototype.recognize = (() => {
            let _recognize = builder.IntentDialog.prototype.recognize;
            return function (context, cb) {
                let _dialog = this;
                _recognize.apply(_dialog, [context, (err, result) => {
                        let message = context.message;
                        let address = message.address || {};
                        let conversation = address.conversation || {};
                        let user = address.user || {};
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
                        self.appInsightsClient.trackEvent(events_1.default.Intent.name, item);
                        // Tracking entities for the event
                        if (result && result.entities) {
                            result.entities.forEach(value => {
                                let entityItem = _.clone(item);
                                entityItem.entityType = value.type;
                                entityItem.entityValue = value.entity;
                                self.appInsightsClient.trackEvent(events_1.default.Entity.name, entityItem);
                            });
                        }
                        // Todo: on "set alarm" utterence, failiure
                        return cb(err, result);
                    }]);
            };
        })();
    }
    startTransaction(context, name = '') {
        let message = context.message;
        let address = message.address || {};
        let conversation = address.conversation || {};
        let user = address.user || {};
        let item = {
            name: name,
            timestamp: message.timestamp,
            channel: address.channelId,
            conversationId: conversation.id,
            userId: user.id,
            userName: user.name
        };
        this.appInsightsClient.trackEvent(events_1.default.StartTransaction.name, item);
    }
    endTransaction(context, name = '', successful = true) {
        let message = context.message;
        let address = message.address || {};
        let conversation = address.conversation || {};
        let user = address.user || {};
        let item = {
            name: name,
            successful: successful.toString(),
            timestamp: message.timestamp,
            channel: address.channelId,
            conversationId: conversation.id,
            userId: user.id,
            userName: user.name
        };
        this.appInsightsClient.trackEvent(events_1.default.EndTransaction.name, item);
    }
}
exports.BotFrameworkInstrumentation = BotFrameworkInstrumentation;

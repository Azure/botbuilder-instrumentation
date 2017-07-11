# Microsoft Bot Builder Instrumentation
This module is used to add instrumentation to bots built with [Microsoft Bot Framework](https://dev.botframework.com/).
You can leverage the events from this module using [Ibex Dashboard](https://github.com/CatalystCode/ibex-dashboard).

## Getting Started

1. Create an Application Insights service under your subscription.
2. Use the `Instrumentation Key` inside your bot registration page under _Instrumentation key_.
3. Under the App Insights service, go to **API Access** and copy **Application ID**
4. Under the App Insights service, go to **API Access >> New Key** with _Read_ permissions and copy **Api Key**.

## Connect to Cognitive Services
This is an optional step in case you want user messages to be analised for setiments.
Create a new [Sentiment Analisys Service under Cognitive Services](https://www.microsoft.com/cognitive-services/en-us/text-analytics-api).
When creating the service, make sure to mark **Text Analytics - Preview**.

## Setting Environment Variables
You can use the following option for running locally.

```bash
APPINSIGHTS_INSTRUMENTATIONKEY={App Insights Instrumentation Key}
CG_SENTIMENT_KEY={Cognitive Services Text Analytics Key}
```

`CG_SENTIMENT_KEY` is optional.

## Adding instrumentation to your code

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATIONKEY,
  sentimentKey: process.env.CG_SENTIMENT_KEY,
});
logging.monitor(bot);
```

If you're using a `LuisRecognizer', use the following code in addition:

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATIONKEY,
  sentimentKey: process.env.CG_SENTIMENT_KEY,
});
let recognizaer = new builder.LuisRecognizer('...');
logging.monitor(bot, recognizer);
``` 

Although `CG_SENTIMENT_KEY` is optional, it is recommended if you're using [Ibex Dashboard](https://github.com/CatalystCode/ibex-dashboard), in which case, adding sentiment analytsis will add sentiments overview to the dashboard along with a sentiment icon next to all conversations.

## Sending logs for QnA maker service

```js
// Hook into the result function of QNA to extract relevant data for logging.
loggins.trackQNAEvent(context, userQuery, kbQuestion, kbAnswer, score);
```

You can see how to implement a QnA service [here](https://github.com/Microsoft/BotBuilder-CognitiveServices/tree/master/Node/samples/QnAMakerWithFunctionOverrides).

## Additional settings

```js
let logger = new instrumentation.BotFrameworkInstrumentation({
  instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATIONKEY,
  sentimentKey: process.env.CG_SENTIMENT_KEY,

  // Will omit the user name from the logs for anonimization
  omitUserName: true,

  // Application insights options, all set to false by default
  autoLogOptions: { 
    autoCollectConsole: true,
    autoCollectExceptions: true,
    autoCollectRequests: true,
    autoCollectPerf: true // (auto collect performance)
  }

  customFields: {
    userData: [ "CUSTOM_PROPERTY_1" ],
    dialogData: [ "CUSTOM_PROPERTY_2" ],
    conversationData: [ "CUSTOM_PROPERTY_3" ],
    privateConversationData: [ "CUSTOM_PROPERTY_4" ]
  }
});
```

The `CUSTOM_PROPERTY` will be searched for in the session/context object of each event, and will be added automatically under customDimentions in Application Insights.
If it does not exist, it will not be added to the logged events.
You can use any, all or none of the property bags under session: `userData`, `conversationData`, `privateConversationData`, `dialogData`.

## Logging custom events

```js
// This will show up as the event name in Application Insights.
let customEventName = 'myCustomEventName';
// Custom key-value data. It will be avaiable under the customDimentions column in Application Insights.
let customEventData = { customeDataA: 'customValueA', customDataB: 3 };

// You can log using context, in which case, session variables like timespan, userId etc will also be logged
logging.trackCustomEvent(customEventName, customEventData, context); 

// You can log without a session/context
logging.trackCustomEvent(customEventName, customEventData); 

// And you can log without an event name, in which case the event name will be 'MBFEvent.CustomEvent'
logging.trackEvent(customEventData);
```

You can see a working sample in [morsh/bot-with-instrumentation](https://github.com/morsh/bot-with-instrumentation)

## License
This project is licensed under the MIT License.
# Adding Logging to an Existing bot
Follow these steps:

## Connect to Application Insights

1. Create an Application Insights service under your subscription.
2. Use the `Instrumentation Key` inside your bot registration page under _Instrumentation key_.
3. Under the App Insights serivce, go to **API Access** and copy **Application ID**
4. Under the App Insights serivce, go to **API Access >> New Key** with _Read_ permissions and copy **Api Key**.

## Connect to Cognitive Services
Create a new [Sentiment Analisys Service under Cognitive Services](https://www.microsoft.com/cognitive-services/en-us/text-analytics-api).
When creating the service, make sure to mark **Text Analytics - Preview**.

## Setting Environment Variables

```sh
APPINSIGHTS_INSTRUMENTATIONKEY={App Insights Instrumentation Key}
CG_SENTIMENT_KEY={Cognitive Services Text Analytics Key}
```

## Connecting to Code

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATIONKEY,
  sentimentKey: process.env.CG_SENTIMENT_KEY,
});
logging.monitor(bot);
```

## Using mutiple instumentation keys

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: ["main insturmnation key","secondary instumentation key"],
  sentimentKey: process.env.CG_SENTIMENT_KEY,
});
logging.monitor(bot);
```

You can see a working sample in [https://github.com/morsh/bot-with-instrumentation](https://github.com/morsh/bot-with-instrumentation)
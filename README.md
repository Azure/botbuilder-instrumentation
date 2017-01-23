# Adding Logging to an Existing bot
Follow these steps:

## Connect to Application Insights

1. Create an Application Insights service under your subscription.
2. Use the `Instrumentation Key` inside your bot registration page under _Instrumentation key_.
3. Uner the App Insights serivce, go to **API Access** and copy **Application ID**
4. Uner the App Insights serivce, go to **API Access >> New Key** with _Read_ permissions and copy **Api Key**.

## Connect to Cognitive Services
Create a new [Sentiment Analisys Service under Cognitive Services](https://www.microsoft.com/cognitive-services/en-us/text-analytics-api).
When creating the service, make sure to mark **Text Analytics - Preview**.

## Setting Environment Variables

```sh
APPINSIGHTS_INSTRUMENTATIONKEY=17b45976-7f04-4f49-a771-3446788959e0
CG_SENTIMENT_KEY=d19acc35642b4ce4876199b8b39d6ba3
```

## Connecting to Code

```js
var logging = require('bot-fmk-logging');

logging.monitor(bot, { transactions: [
    {
        intent: 'alarm.set',
        test: /^(Creating alarm named)/i
    }
]});
```
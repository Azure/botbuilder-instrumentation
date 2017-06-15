var monitor = require('./');
var bot = null;
monitor.monitor(bot, { transactions: [
        {
            intent: 'alarm.set',
            test: /^(Creating alarm named)/i
        }
    ] });
//# sourceMappingURL=/Users/lilian/GitHub/botbuilder-instrumentation/dist/example.js.map
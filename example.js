var monitor = require('./');
var bot = null; // botbuilder object

monitor(bot, { transactions: [
    {
        intent: 'alarm.set',
        test: /^(Creating alarm named)/i
    }
]});
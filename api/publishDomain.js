import redis from 'redis';

const publisher = redis.createClient();
const channel = 'NEW_DOMAIN';

publisher.on('error', function (error) {
    throw new Error(error);
});

const args = process.argv.slice(2);

publisher.publish(channel, args[0], () => {
    process.exit();
});

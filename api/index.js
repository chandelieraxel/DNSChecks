import dns from 'dns';
import redis from 'redis';

export default function () {
    const redisOptions = {
        host: process.env.redisHost,
        port: process.env.redisPort,
        password: process.env.redisPassword,
    };

    const cache = redis.createClient(redisOptions);

    const subscriber = redis.createClient(redisOptions);

    const channel = 'NEW_DOMAIN';

    const msBeforeRetry = 5000;
    const maxRetries = 15;

    subscriber.on('error', function (error) {
        throw new Error(error);
    });

    function issueTLSCertificate() {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    data: {
                        certificate:
                            '-----BEGIN CERTIFICATE-----\nMIIEtzCCA5+.......ZRtAfQ6r\nwlW975rYa1ZqEdA=\n-----END CERTIFICATE-----',
                        ttl: 2764800,
                    },
                });
            }, 200);
        });
    }

    function alertCustomer() {
        console.log('Customer has been alerted of the stop of the process. They will resubmit the domain name again');
    }

    function getRetryTime(domainRetriesNumber, domain) {
        // We need to set a maximum retry time to avoid a potential infinite wait for the customer
        if (domainRetriesNumber <= 10) {
            return (domainRetriesNumber + 1) * msBeforeRetry;
        } else {
            return msBeforeRetry * 20;
        }
    }

    function nextDNSCheck(domain, secondsBeforeRetry) {
        setTimeout(() => {
            cache.get(domain, (err, data) => {
                const domainData = JSON.parse(data);

                DNSCheck(domain, domainData);
            });
        }, secondsBeforeRetry);
    }

    function DNSCheck(domain, domainData) {
        console.log('Domain check for : ', domain);

        dns.lookup(domain, async (error, address) => {
            if (address) {
                try {
                    console.log('Domain valid, creating the TLS certificate ...');

                    const certificate = await issueTLSCertificate();

                    console.log('Certificate created.');
                    cache.set(domain, JSON.stringify({ isValid: true, certificate }));
                } catch (error) {
                    throw new Error(`An error happened when creating the TLS certificate : ${error.message}`);
                }
            } else {
                console.log('Domain invalid, launching the retry procedure ...');

                if (domainData?.retriesNumber >= 0) {
                    cache.set(domain, JSON.stringify({ isValid: false, retriesNumber: domainData.retriesNumber + 1 }));

                    // When we reach a certain threshold, we remove the domain from the cache to avoid potentially infinite try on a domain name that could never be setup
                    if (domainData.retriesNumber + 1 > maxRetries) {
                        alertCustomer();

                        cache.del(domain);

                        console.log(`${domain} has been successfully removed from the cache`);
                        return;
                    }

                    const msBeforeRetryIncremented = getRetryTime(domainData.retriesNumber, domain);

                    console.log(`Retrying in ${msBeforeRetryIncremented / 1000} seconds`);

                    nextDNSCheck(domain, msBeforeRetryIncremented);
                } else {
                    cache.set(domain, JSON.stringify({ isValid: false, retriesNumber: 0 }));

                    nextDNSCheck(domain, msBeforeRetry);
                }
            }
        });
    }

    subscriber.on('message', (channel, domain) => {
        cache.get(domain, (err, data) => {
            const domainData = JSON.parse(data);

            // If the domain is already in the cache, it means either it has already has been validated, or is under validation
            if (domainData) {
                console.log(`${domain} already in cache, skipping check`);
                return;
            }

            DNSCheck(domain, domainData);
        });
    });

    subscriber.subscribe(channel);

    // If the server reset for any reason, we launch again the previous ongoing retries
    cache.keys('*', (err, replies) => {
        console.log('App reboot, getting all cached domain names ...');

        replies.forEach((domain) => {
            cache.get(domain, (err, data) => {
                const domainData = JSON.parse(data);

                if (!domainData.isValid) DNSCheck(domain, domainData);
            });
        });
    });
}

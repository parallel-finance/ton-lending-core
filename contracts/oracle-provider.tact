import "@stdlib/deploy";
import "@stdlib/ownable";
import "@stdlib/stoppable";
import "./types/message";
message AddFeeder {
    feeder: Address;
}
message RemoveFeeder {
    feeder: Address;
}
message FeedPrices {
    prices: map<Address, Int>;
}
message FeedEmergencyPrices {
    prices: map<Address, Int>;
}
message FetchPrices {
    prices: map<Address, Int>;
    payload: Slice as remaining;
}
message FetchPricesResponse {
    prices: map<Address, Int>;
    payload: Slice as remaining;
}
message UpdatePool {
    pool: Address;
}
message UpdateConfig {
    expirationPeriod: Int;
    maxDeviationRate: Int;
}

struct OracleData {
    owner: Address;
    stopped: Bool;
    pool: Address;
    expirationPeriod: Int;
    maxDeviationRate: Int;
    feeders: map<Address, Bool>;
    prices: map<Address, PriceData>;
}

// 5 minutes
const EXPIRATION_PERIOD: Int = 300;
// reject when price +30% or -30%, based on 10000;
const MAX_DEVIATION_RATE: Int = 3000;

contract OracleProvider with Deployable, Ownable, Resumable {
    owner: Address;
    stopped: Bool;

    pool: Address;
    expirationPeriod: Int;
    maxDeviationRate: Int;

    feeders: map<Address, Bool>;
    prices: map<Address, PriceData>;

    init(pool: Address){
        self.owner = sender();
        self.stopped = false;
        self.pool = pool;
        self.expirationPeriod = EXPIRATION_PERIOD;
        self.maxDeviationRate = MAX_DEVIATION_RATE;
    }

    // ====== Received Messages ====== //
    receive(msg: AddFeeder){
        self.requireOwner();
        self.feeders.set(msg.feeder, true);
    }

    receive(msg: RemoveFeeder){
        self.requireOwner();
        self.feeders.del(msg.feeder);
    }

    // Pull mode: fetch prices
    receive(msg: FetchPrices) {
        self.fetchPrices(msg);
    }

    // Push mode: feed prices to pool
    receive(msg: FeedPrices){
        self.requireFeeder(sender());
        self.feedPrices(msg.prices, true);
    }

    receive(msg: FeedEmergencyPrices){
        self.requireOwner();
        self.feedPrices(msg.prices, false);
    }

    receive(msg: UpdatePool){
        self.requireOwner();
        self.pool = msg.pool;
    }

    receive(msg: UpdateConfig){
        self.requireOwner();
        self.expirationPeriod = msg.expirationPeriod;
        require(msg.maxDeviationRate <= 10000, "invalid maxDeviationRate");
        self.maxDeviationRate = msg.maxDeviationRate;
    }

    // ====== Internal Methods ====== //
    fun feedPrices(prices: map<Address, Int>, validation: Bool) {
        let nowTimestamp: Int = now();
        foreach(reserve, price in prices) {
            if (validation) {
                self.validatePrice(reserve, price);
            }
            self.prices.set(reserve, PriceData{
                price: price,
                lastUpdateTime: nowTimestamp
            });
        }

        self.pushToPool(prices);
    }

    fun pushToPool(prices: map<Address, Int>) {
        send(SendParameters{
            to: self.pool,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: SyncPrices{
                prices: prices,
                responseDestination: sender()
            }.toCell()
        });
    }

    fun fetchPrices(msg: FetchPrices) {
        let prices: map<Address, Int> = msg.prices;
        foreach(reserve, _ in prices) {
            prices.set(reserve, self.price(reserve));
        }
        send(SendParameters{
            to: sender(),
            value: 0,
            bounce: false,
            mode: SendRemainingValue,
            body: FetchPricesResponse{
                prices: prices,
                payload: msg.payload
            }.toCell()
        });
    }

    fun validatePrice(reserve: Address, price: Int) {
        let currentPriceData: PriceData? = self.prices.get(reserve);
        if (currentPriceData == null) {
            return;
        }
        if (price > currentPriceData!!.price) {
            let maxAllowedPrice: Int = currentPriceData!!.price * (10000 + self.maxDeviationRate) / 10000;
            require(price != 0 && price <= maxAllowedPrice, "invalid price data");
        } else {
            let minAllowedPrice: Int = currentPriceData!!.price * (10000 - self.maxDeviationRate) / 10000;
            require(price != 0 && price >= minAllowedPrice, "invalid price data");
        }
    }

    fun requireFeeder(feeder: Address) {
        let isFeeder: Bool? = self.feeders.get(feeder);
        require(isFeeder == true, "invalid feeder");
    }

    // ====== Get Methods ====== //
    get fun oracleData(): OracleData {
        return OracleData{
            owner: self.owner,
            stopped: self.stopped,
            pool: self.pool,
            expirationPeriod: self.expirationPeriod,
            maxDeviationRate: self.maxDeviationRate,
            feeders: self.feeders,
            prices: self.prices
        };
    }

    // get price with validation
    get fun price(reserve: Address): Int {
        let priceData: PriceData? = self.prices.get(reserve);
        if (
            priceData == null || 
            now() - priceData!!.lastUpdateTime > self.expirationPeriod
        ) {
            return 0;
        }
        return priceData!!.price;
    }

    // get all prices with validation
    get fun allPrices(): map<Address, Int> {
        let prices: map<Address, Int> = emptyMap();
        let nowTimestamp: Int = now();
        foreach(reserve, priceData in self.prices) {
            if (nowTimestamp - priceData.lastUpdateTime <= self.expirationPeriod) {
                prices.set(reserve, priceData.price);
            }
        }
        return prices;
    }
}
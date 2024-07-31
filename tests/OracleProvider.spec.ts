import {
    Blockchain,
    BlockchainSnapshot,
    printTransactionFees,
    SandboxContract,
    Treasury,
    TreasuryContract,
} from '@ton/sandbox';
import '@ton/test-utils';
import { Address, beginCell, Cell, Dictionary, fromNano, Slice, toNano } from '@ton/core';
import { ATokenDTokenContents, Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { OracleProvider } from '../wrappers/OracleProvider';
import { EXPIRATION_PERIOD, MAX_DEVIATION_RATE, PERCENTAGE_FACTOR } from '../helpers/constant';
import { randomAddress } from '@ton/test-utils';
import { sumTransactionsFee } from '../jest.setup';
import { sleep } from '@ton/blueprint';

describe('Oracle Provider test', () => {
    let blockchain: Blockchain;
    let snapshot: BlockchainSnapshot;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton1: SandboxContract<SampleJetton>;
    let sampleJetton2: SandboxContract<SampleJetton>;
    let oracleProvider: SandboxContract<OracleProvider>;

    let addresses: any = {};

    let reserveConfiguration1: ReserveConfiguration;
    let reserveConfiguration2: ReserveConfiguration;
    let reserveInterestRateStrategy: ReserveInterestRateStrategy;
    let contents1: ATokenDTokenContents;
    let contents2: ATokenDTokenContents;

    jest.setTimeout(60 * 1000);

    beforeAll(async () => {
        reserveInterestRateStrategy = {
            $$type: 'ReserveInterestRateStrategy',
            optimalUsageRatio: BigInt(0.9 * 10 ** 27),
            maxUsageRatio: BigInt(10 ** 27) - BigInt(0.9 * 10 ** 27),
            baseBorrowRate: 0n,
            slope1: BigInt(0.04 * 10 ** 27),
            slope2: BigInt(0.6 * 10 ** 27),
        };

        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        addresses.deployer = deployer.address;
        secondUser = (await blockchain.createWallets(2))[1];
        addresses.secondUser = secondUser.address;

        pool = blockchain.openContract(await Pool.fromInit());
        // deploy pool
        const deployResult = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
        addresses.pool = pool.address;

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            deploy: true,
            success: true,
        });

        let max_supply = toNano(1000000n); // 🔴 Set the specific total supply in nano
        let content1 = buildOnchainMetadata({
            name: 'SampleJetton 1',
            description: 'Sample Jetton 1',
            decimals: '9',
            image: '',
            symbol: 'SAM1',
        });
        contents1 = {
            $$type: 'ATokenDTokenContents',
            aTokenContent: buildOnchainMetadata({
                name: 'SampleJetton 1 AToken',
                description: 'Sample Jetton 1 aToken',
                decimals: '9',
                image: '',
                symbol: 'aSAM1',
            }),
            dTokenContent: buildOnchainMetadata({
                name: 'SampleJetton 1 DToken',
                description: 'Sample Jetton 1 dToken',
                decimals: '9',
                image: '',
                symbol: 'dSAM1',
            }),
        };
        let content2 = buildOnchainMetadata({
            name: 'SampleJetton 2',
            description: 'Sample Jetton 2',
            decimals: '6',
            image: '',
            symbol: 'SAM2',
        });
        contents2 = {
            $$type: 'ATokenDTokenContents',
            aTokenContent: buildOnchainMetadata({
                name: 'SampleJetton 2 AToken',
                description: 'Sample Jetton 2 aToken',
                decimals: '6',
                image: '',
                symbol: 'aSAM2',
            }),
            dTokenContent: buildOnchainMetadata({
                name: 'SampleJetton 2 DToken',
                description: 'Sample Jetton 2 dToken',
                decimals: '6',
                image: '',
                symbol: 'dSAM2',
            }),
        };

        sampleJetton1 = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content1, max_supply));
        sampleJetton2 = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content2, max_supply));

        await sampleJetton1.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
        await sampleJetton2.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );

        const getPoolWalletAndATokenAndDToken = async (
            jetton: SandboxContract<SampleJetton>,
            contents: ATokenDTokenContents,
        ): Promise<{
            poolWalletAddress: Address;
            aTokenAddress: Address;
            dTokenAddress: Address;
        }> => {
            return {
                poolWalletAddress: await jetton.getGetWalletAddress(pool.address),
                aTokenAddress: await pool.getCalculateATokenAddress(contents.aTokenContent, jetton.address),
                dTokenAddress: await pool.getCalculateDTokenAddress(contents.dTokenContent, jetton.address),
            };
        };

        addresses.sampleJetton1 = sampleJetton1.address;
        addresses.sampleJetton2 = sampleJetton2.address;

        const {
            poolWalletAddress: poolWalletAddress1,
            aTokenAddress: aTokenAddress1,
            dTokenAddress: dTokenAddress1,
        } = await getPoolWalletAndATokenAndDToken(sampleJetton1, contents1);
        const {
            poolWalletAddress: poolWalletAddress2,
            aTokenAddress: aTokenAddress2,
            dTokenAddress: dTokenAddress2,
        } = await getPoolWalletAndATokenAndDToken(sampleJetton2, contents2);
        const commonReserveConfiguration = {
            ltv: 6000n,
            liquidationThreshold: 7500n,
            liquidationBonus: 10500n,
            reserveFactor: 1000n,
            liquidationProtocolFee: 500n,
            isActive: true,
            isFrozen: false,
            borrowingEnabled: true,
            supplyCap: 1000000n,
            borrowCap: 1000000n,
        };
        reserveConfiguration1 = {
            $$type: 'ReserveConfiguration',
            ...commonReserveConfiguration,
            poolWalletAddress: poolWalletAddress1,
            aTokenAddress: aTokenAddress1,
            dTokenAddress: dTokenAddress1,
            treasury: sampleJetton1.address,
            decimals: 9n,
        };
        reserveConfiguration2 = {
            $$type: 'ReserveConfiguration',
            ...commonReserveConfiguration,
            poolWalletAddress: poolWalletAddress2,
            aTokenAddress: aTokenAddress2,
            dTokenAddress: dTokenAddress2,
            treasury: sampleJetton2.address,
            decimals: 6n,
        };

        // add reserve sample Jetton 1
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'AddReserve',
                reserveAddress: sampleJetton1.address,
                reserveConfiguration: reserveConfiguration1,
                contents: contents1,
                reserveInterestRateStrategy,
            },
        );

        // add reserve sample Jetton 2
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'AddReserve',
                reserveAddress: sampleJetton2.address,
                reserveConfiguration: reserveConfiguration2,
                contents: contents2,
                reserveInterestRateStrategy,
            },
        );

        const mintTestJetton = async (jetton: SandboxContract<SampleJetton>, receiver: Address, amount: bigint) => {
            await jetton.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'Mint',
                    queryId: 0n,
                    amount,
                    receiver,
                },
            );
        };

        await mintTestJetton(sampleJetton1, deployer.getSender().address, toNano(100000n));
        await mintTestJetton(sampleJetton2, deployer.getSender().address, toNano(10000n));
        await mintTestJetton(sampleJetton1, secondUser.address, toNano(100000n));
        await mintTestJetton(sampleJetton2, secondUser.address, toNano(100000n));

        await setMockOraclePrice(sampleJetton1.address, toNano('1'));
        await setMockOraclePrice(sampleJetton2.address, toNano('1'));

        oracleProvider = blockchain.openContract(await OracleProvider.fromInit(pool.address));
        await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
        expect(await oracleProvider.getOwner()).toEqualAddress(deployer.address);
        addresses.oracleProvider = oracleProvider.address.toString();
    });

    beforeEach(async () => {
        snapshot = blockchain.snapshot();
    });
    afterEach(async () => {
        await blockchain.loadFrom(snapshot);
        priceAddresses();
    });

    const priceAddresses = () => {
        const printAddress: any = {};
        Object.entries(addresses).forEach(([key, value]) => {
            printAddress[key] = (value as Address).toString();
        });
        console.table(printAddress);
    };

    const setMockOraclePrice = async (jetton: Address, price: bigint) => {
        const rst = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetMockOraclePrice',
                asset: jetton,
                price: price,
            },
        );
        expect(rst.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        const reserveData = await pool.getReserveData(jetton);
        expect(reserveData.price).toEqual(price);
    };

    const addFeeder = async (feeder: Address) => {
        await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.01'),
            },
            {
                $$type: 'AddFeeder',
                feeder: feeder,
            },
        );

        expect((await oracleProvider.getOracleData()).feeders.keys().map((v) => v.toString())).toContain(
            feeder.toString(),
        );
    };

    const feedPrices = async (prices: Dictionary<Address, bigint>) => {
        await addFeeder(deployer.address);

        const now = BigInt(Math.floor(Date.now() / 1000));
        let result = await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.0165') * BigInt(prices.size),
            },
            {
                $$type: 'FeedPrices',
                prices,
            },
        );
        // FeedPrices
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: oracleProvider.address,
            success: true,
        });
        // SyncPrices
        expect(result.transactions).toHaveTransaction({
            from: oracleProvider.address,
            to: pool.address,
            success: true,
        });
        // cashback
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: deployer.address,
            success: true,
        });
        for (const jetton of prices.keys()) {
            const priceInOracle = await oracleProvider.getPrice(jetton);
            const allPricesInOracle = await oracleProvider.getAllPrices();
            const priceDataInOracle = (await oracleProvider.getOracleData()).prices.get(jetton);
            const priceInPool = (await pool.getReserveData(jetton)).price;

            const expectedPrice = prices.get(jetton);

            expect(priceInOracle).toEqual(expectedPrice);
            expect(allPricesInOracle.get(jetton)).toEqual(expectedPrice);
            expect(priceDataInOracle?.price).toEqual(expectedPrice);
            // expect(priceDataInOracle?.lastUpdateTime).toEqual(now);
            expect(Number(priceDataInOracle?.lastUpdateTime)).toBeCloseTo(Number(now), -1);
            expect(priceInPool).toEqual(expectedPrice);
        }

        return result;
    };

    it('check basic configs', async () => {
        const oracleData = await oracleProvider.getOracleData();
        expect(oracleData.pool).toEqualAddress(pool.address);
        expect(oracleData.owner).toEqualAddress(deployer.address);
        expect(oracleData.stopped).toEqual(false);
        expect(oracleData.maxDeviationRate).toEqual(MAX_DEVIATION_RATE);
        expect(oracleData.expirationPeriod).toEqual(EXPIRATION_PERIOD);
    });

    it('setFeeder', async () => {
        await addFeeder(deployer.address);
        await addFeeder(secondUser.address);
    });

    it('update Pool', async () => {
        const mockNewPool = randomAddress();
        await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.01'),
            },
            { $$type: 'UpdatePool', pool: mockNewPool },
        );
        expect((await oracleProvider.getOracleData()).pool).toEqualAddress(mockNewPool);
    });

    it('update Configs', async () => {
        const newMaxDeviationRate = 1n;
        const newExpirationPeriod = 1n;
        await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.01'),
            },
            {
                $$type: 'UpdateConfig',
                maxDeviationRate: newMaxDeviationRate,
                expirationPeriod: newExpirationPeriod,
            },
        );
        const { expirationPeriod, maxDeviationRate } = await oracleProvider.getOracleData();
        expect(expirationPeriod).toEqual(newExpirationPeriod);
        expect(maxDeviationRate).toEqual(newMaxDeviationRate);
    });

    it('remove feeder', async () => {
        await addFeeder(deployer.address);
        await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.01'),
            },
            {
                $$type: 'RemoveFeeder',
                feeder: deployer.address,
            },
        );

        expect((await oracleProvider.getOracleData()).feeders.keys().map((v) => v.toString())).not.toContain(
            deployer.address.toString(),
        );
    });

    it('feed prices without feeder access', async () => {
        const sampleJetton1Price = toNano('0.11');
        const prices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        prices.set(sampleJetton1.address, sampleJetton1Price);

        let result = await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'FeedPrices',
                prices: prices,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: oracleProvider.address,
            success: false,
        });
    });

    it('feed one price', async () => {
        const sampleJetton1Price = toNano('0.11');
        const prices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        prices.set(sampleJetton1.address, sampleJetton1Price);
        const result = await feedPrices(prices);

        printTransactionFees(result.transactions);
        const sumFee = sumTransactionsFee(result.transactions);
        console.log(`feed one price: ${sumFee}`);
        expect(sumFee).toBeLessThan(0.0165);
    });

    it('feed two prices', async () => {
        const sampleJetton1Price = toNano('0.11');
        const sampleJetton2Price = toNano('0.22');
        const prices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        prices.set(sampleJetton1.address, sampleJetton1Price);
        prices.set(sampleJetton2.address, sampleJetton2Price);

        const result = await feedPrices(prices);

        printTransactionFees(result.transactions);
        const sumFee = sumTransactionsFee(result.transactions);
        console.log(`feed two prices: ${sumFee}`);
        expect(sumFee).toBeLessThan(0.023);
    });

    it('feed one price which is not in pool', async () => {
        await addFeeder(deployer.address);
        const mockReserve = randomAddress();
        const prices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        prices.set(mockReserve, toNano('0.33'));

        const now = BigInt(Math.floor(Date.now() / 1000));
        let result = await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.04'),
            },
            {
                $$type: 'FeedPrices',
                prices: prices,
            },
        );
        // FeedPrices
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: oracleProvider.address,
            success: true,
        });
        // SyncPrices
        expect(result.transactions).toHaveTransaction({
            from: oracleProvider.address,
            to: pool.address,
            success: true,
        });
        // cashback
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: deployer.address,
            success: true,
        });

        const priceInOracle = await oracleProvider.getPrice(mockReserve);
        const priceDataInOracle = (await oracleProvider.getOracleData()).prices.get(mockReserve);
        const expectedPrice = prices.get(mockReserve);

        expect(priceInOracle).toEqual(expectedPrice);
        expect(priceDataInOracle?.price).toEqual(expectedPrice);
        // expect(priceDataInOracle?.lastUpdateTime).toEqual(now);
        expect(Number(priceDataInOracle?.lastUpdateTime)).toBeCloseTo(Number(now), -1);
        const reservesData = await pool.getAllReserveDataAndConfiguration();
        expect(reservesData.keys()).not.toContain(mockReserve);

        printTransactionFees(result.transactions);
        const sumFee = sumTransactionsFee(result.transactions);
        console.log(`feed one price which is not in pool: ${sumFee}`);
    });

    it('get expired price', async () => {
        await addFeeder(deployer.address);

        const { maxDeviationRate } = await oracleProvider.getOracleData();
        const newExpirationPeriod = 1n;
        await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.01'),
            },
            {
                $$type: 'UpdateConfig',
                maxDeviationRate,
                expirationPeriod: newExpirationPeriod,
            },
        );
        expect((await oracleProvider.getOracleData()).expirationPeriod).toEqual(newExpirationPeriod);

        const sampleJetton1Price = toNano('0.11');
        const prices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        prices.set(sampleJetton1.address, sampleJetton1Price);

        const now = BigInt(Math.floor(Date.now() / 1000));
        let result = await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.017') * BigInt(prices.size),
            },
            {
                $$type: 'FeedPrices',
                prices,
            },
        );
        // FeedPrices
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: oracleProvider.address,
            success: true,
        });
        // SyncPrices
        expect(result.transactions).toHaveTransaction({
            from: oracleProvider.address,
            to: pool.address,
            success: true,
        });
        // cashback
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: deployer.address,
            success: true,
        });

        await sleep(2000);

        const priceInOracle = await oracleProvider.getPrice(sampleJetton1.address);
        expect(priceInOracle).toEqual(0n);
        const priceDataInOracle = (await oracleProvider.getOracleData()).prices.get(sampleJetton1.address);
        expect(priceDataInOracle?.price).toEqual(sampleJetton1Price);
        expect(Number(priceDataInOracle?.lastUpdateTime)).toBeCloseTo(Number(now), -1);
        console.log(await pool.getAllReserveDataAndConfiguration());
        const reserveData = await pool.getReserveData(sampleJetton1.address);
        expect(reserveData.price).toEqual(sampleJetton1Price);
        console.log(reserveData);
    });

    it('feed price exceed maxDeviationRate', async () => {
        await addFeeder(deployer.address);
        const { maxDeviationRate } = await oracleProvider.getOracleData();

        const sampleJetton1Price = toNano('0.11');
        const prices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        prices.set(sampleJetton1.address, sampleJetton1Price);

        await feedPrices(prices);

        // exceed the maxDeviationRate + 30%
        let newPrices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        newPrices.set(
            sampleJetton1.address,
            (sampleJetton1Price * (PERCENTAGE_FACTOR + maxDeviationRate)) / PERCENTAGE_FACTOR + 1n,
        );

        let result = await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.0165') * BigInt(prices.size),
            },
            {
                $$type: 'FeedPrices',
                prices: newPrices,
            },
        );
        // FeedPrices
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: oracleProvider.address,
            success: false,
        });

        // exceed the maxDeviationRate -30%
        newPrices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        newPrices.set(
            sampleJetton1.address,
            (sampleJetton1Price * (PERCENTAGE_FACTOR - maxDeviationRate)) / PERCENTAGE_FACTOR - 1n,
        );

        result = await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.0165') * BigInt(prices.size),
            },
            {
                $$type: 'FeedPrices',
                prices: newPrices,
            },
        );
        // FeedPrices
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: oracleProvider.address,
            success: false,
        });
    });

    it('feed emergency price', async () => {
        const { maxDeviationRate } = await oracleProvider.getOracleData();

        const sampleJetton1Price = toNano('0.11');
        const prices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        prices.set(sampleJetton1.address, sampleJetton1Price);

        await feedPrices(prices);

        // exceed the maxDeviationRate + 30%
        let newPrices = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        newPrices.set(
            sampleJetton1.address,
            (sampleJetton1Price * (PERCENTAGE_FACTOR + maxDeviationRate)) / PERCENTAGE_FACTOR + 1n,
        );
        const now = BigInt(Math.floor(Date.now() / 1000));
        let result = await oracleProvider.send(
            deployer.getSender(),
            {
                value: toNano('0.0165') * BigInt(prices.size),
            },
            {
                $$type: 'FeedEmergencyPrices',
                prices: newPrices,
            },
        );
        // FeedPrices
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: oracleProvider.address,
            success: true,
        });
        // SyncPrices
        expect(result.transactions).toHaveTransaction({
            from: oracleProvider.address,
            to: pool.address,
            success: true,
        });
        // cashback
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: deployer.address,
            success: true,
        });

        const jetton = sampleJetton1.address;
        const priceInOracle = await oracleProvider.getPrice(jetton);
        const allPricesInOracle = await oracleProvider.getAllPrices();
        const priceDataInOracle = (await oracleProvider.getOracleData()).prices.get(jetton);
        const priceInPool = (await pool.getReserveData(jetton)).price;

        const expectedPrice = newPrices.get(jetton);

        expect(priceInOracle).toEqual(expectedPrice);
        expect(allPricesInOracle.get(jetton)).toEqual(expectedPrice);
        expect(priceDataInOracle?.price).toEqual(expectedPrice);
        // expect(priceDataInOracle?.lastUpdateTime).toEqual(now);
        expect(Number(priceDataInOracle?.lastUpdateTime)).toBeCloseTo(Number(now), -1);
        expect(priceInPool).toEqual(expectedPrice);
    });
});

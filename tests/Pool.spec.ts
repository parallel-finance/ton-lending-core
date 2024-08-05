import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, toNano } from '@ton/core';
import { ATokenDTokenContents, Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import '@ton/test-utils';
import { buildOnchainMetadata } from '../scripts/utils';
import { RAY } from '../helpers/constant';
import { AToken } from '../build/Pool/tact_AToken';
import { deployPool } from './utils';

describe('Pool', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;

    const reserveAddress = address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV');
    const aTokenJettonParams = {
        name: 'SampleJetton AToken',
        description: 'Sample Jetton aToken',
        decimals: '9',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'aSAM',
    };
    let aTokenContent = buildOnchainMetadata(aTokenJettonParams);

    const dTokenJettonParams = {
        name: 'SampleJetton DToken',
        description: 'Sample Jetton dToken',
        decimals: '9',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'dSAM',
    };
    let dTokenContent = buildOnchainMetadata(dTokenJettonParams);

    const contents: ATokenDTokenContents = {
        $$type: 'ATokenDTokenContents',
        aTokenContent,
        dTokenContent,
    };

    const reserveConfiguration: ReserveConfiguration = {
        $$type: 'ReserveConfiguration',
        poolWalletAddress: reserveAddress,
        aTokenAddress: reserveAddress,
        dTokenAddress: reserveAddress,
        ltv: 6000n,
        liquidationThreshold: 750n,
        liquidationBonus: 500n,
        reserveFactor: 1000n,
        liquidationProtocolFee: 50n,
        isActive: true,
        isFrozen: false,
        borrowingEnabled: true,
        supplyCap: 1000000n,
        borrowCap: 1000000n,
        treasury: reserveAddress,
        decimals: 9n,
    };

    const reserveInterestRateStrategy: ReserveInterestRateStrategy = {
        $$type: 'ReserveInterestRateStrategy',
        optimalUsageRatio: 7000n,
        maxUsageRatio: 3000n,
        baseBorrowRate: 1000n,
        slope1: 1000n,
        slope2: 3000n,
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        pool = blockchain.openContract(await Pool.fromInit());

        deployer = await blockchain.treasury('deployer');

        await deployPool(pool, deployer);

        reserveConfiguration.aTokenAddress = await pool.getCalculateATokenAddress(
            contents.aTokenContent,
            reserveAddress,
        );
        reserveConfiguration.dTokenAddress = await pool.getCalculateDTokenAddress(
            contents.dTokenContent,
            reserveAddress,
        );
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and pool are ready to use
    });

    describe('addReserve', () => {
        it('should add reserve successfully', async () => {
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration,
                    contents,
                    reserveInterestRateStrategy,
                },
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: true,
            });

            // TODO: the aToken calculated from Atoken.fromInit and pool.getCalculateATokenAddress is different!!! why?
            // const aToken = blockchain.openContract(await AToken.fromInit(pool.address, contents.aTokenContent, reserveAddress))
            const aToken = blockchain.openContract(AToken.fromAddress(reserveConfiguration.aTokenAddress));
            expect((await aToken.getOwner()).toString()).toEqual(pool.address.toString());
            expect((await aToken.getGetPoolData()).pool.toString()).toEqual(pool.address.toString());
            expect((await aToken.getGetPoolData()).asset.toString()).toEqual(reserveAddress.toString());

            const reserveLength = await pool.getReservesLength();
            expect(reserveLength).toEqual(1n);

            const reserveAddressResult = await pool.getReserveAddress(0n);
            expect(reserveAddressResult.toString()).toEqual(reserveAddress.toString());

            const reserveData = await pool.getReserveData(reserveAddress);
            expect(reserveData).toMatchObject({
                liquidityIndex: RAY,
                borrowIndex: RAY,
                totalSupply: 0n,
                availableLiquidity: 0n,
                accruedToTreasury: 0n,
                totalBorrow: 0n,
                // ignore lastUpdateTimestamp
            });

            const reserveConfigurationResult = await pool.getReserveConfiguration(reserveAddress);
            expect(reserveConfiguration.aTokenAddress.toString()).toEqual(aToken.address.toString());
            const { poolWalletAddress, aTokenAddress, dTokenAddress, treasury, ...otherReserveConfiguration } =
                reserveConfigurationResult;
            expect(reserveConfiguration).toMatchObject(otherReserveConfiguration);
            expect(aTokenAddress.toString()).toEqual(reserveConfiguration.aTokenAddress.toString());
            expect(dTokenAddress.toString()).toEqual(reserveConfiguration.dTokenAddress.toString());
            expect(poolWalletAddress.toString()).toEqual(reserveConfiguration.poolWalletAddress.toString());
            expect(treasury.toString()).toEqual(reserveConfiguration.treasury.toString());
        });

        it('should fail if reserve already exists', async () => {
            await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration,
                    contents,
                    reserveInterestRateStrategy,
                },
            );

            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration,
                    contents,
                    reserveInterestRateStrategy,
                },
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: false,
            });
        });

        it('should fail if reserve config is invalid', async () => {
            // TODO
        });

        // Skip owner check
        // Skip stopped check
    });

    describe('dropReserve', () => {
        beforeEach(async () => {
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration,
                    contents,
                    reserveInterestRateStrategy,
                },
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: true,
            });
        });

        it('should drop reserve successfully', async () => {
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 0n,
                },
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: true,
            });

            const reserveLength = await pool.getReservesLength();
            expect(reserveLength).toEqual(0n);
        });

        it('should fail if reserve index is out of range when drop reserve', async () => {
            const notDeployer = await blockchain.treasury('notDeployer');

            const result = await pool.send(
                notDeployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 1n,
                },
            );

            expect(result.transactions).toHaveTransaction({
                from: notDeployer.address,
                to: pool.address,
                success: false,
            });
        });
    });

    describe('getters', () => {
        beforeEach(async () => {
            await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration,
                    contents,
                    reserveInterestRateStrategy,
                },
            );
        });

        it('should getReserveAddress', async () => {
            const result = await pool.getReserveAddress(0n);
            expect(result.toString()).toEqual(reserveAddress.toString());
        });

        it('should getReserveData', async () => {
            const result = await pool.getReserveData(reserveAddress);
            expect(result).toMatchObject({
                liquidityIndex: RAY,
                borrowIndex: RAY,
                totalSupply: 0n,
                availableLiquidity: 0n,
                accruedToTreasury: 0n,
                totalBorrow: 0n,
                // ignore lastUpdateTimestamp
            });
        });

        it('should getReserveConfiguration', async () => {
            const result = await pool.getReserveConfiguration(reserveAddress);
            const { poolWalletAddress, aTokenAddress, dTokenAddress, treasury, ...otherReserveConfiguration } = result;
            expect(reserveConfiguration).toMatchObject(otherReserveConfiguration);
            expect(aTokenAddress.toString()).toEqual(reserveConfiguration.aTokenAddress.toString());
            expect(dTokenAddress.toString()).toEqual(reserveConfiguration.dTokenAddress.toString());
            expect(poolWalletAddress.toString()).toEqual(reserveConfiguration.poolWalletAddress.toString());
            expect(treasury.toString()).toEqual(reserveConfiguration.treasury.toString());
        });

        it('should getReservesLength', async () => {
            const result = await pool.getReservesLength();
            expect(result).toEqual(1n);
        });
    });
});

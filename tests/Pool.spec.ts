import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, toNano, beginCell, Address, Cell } from '@ton/core';
import { ATokenDTokenContents, Pool, ReserveConfiguration } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { AToken } from '../wrappers/AToken';

describe('Pool', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;

    const reserveAddress = address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV');
    const aTokenJettonParams = {
        name: 'SampleJetton AToken',
        description: 'Sample Jetton aToken',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'aSAM',
    };
    let aTokenContent = buildOnchainMetadata(aTokenJettonParams);
    const contents: ATokenDTokenContents = {
        $$type: 'ATokenDTokenContents',
        aTokenContent,
        dTokenContent: Cell.EMPTY, // TODO
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
        optimalUsageRatio: 7000n,
        slope1: 1000n,
        slope2: 3000n,
        borrowingEnabled: true,
        supplyCap: 1000000n,
        borrowCap: 1000000n,
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        pool = blockchain.openContract(await Pool.fromInit());

        deployer = await blockchain.treasury('deployer');

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

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            deploy: true,
            success: true,
        });

        const calculateATokenAddress = await pool.getCalculateATokenAddress(contents.aTokenContent, reserveAddress);
        reserveConfiguration.aTokenAddress = calculateATokenAddress;
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
                liquidityIndex: 1n,
                borrowIndex: 1n,
                totalSupply: 0n,
                availableLiquidity: 0n,
                accruedToTreasury: 0n,
                totalBorrow: 0n,
                // ignore lastUpdateTimestamp
            });

            const reserveConfigurationResult = await pool.getReserveConfiguration(reserveAddress);
            expect(reserveConfiguration.aTokenAddress.toString()).toEqual(aToken.address.toString());
            const { poolWalletAddress, aTokenAddress, dTokenAddress, ...otherReserveConfiguration } =
                reserveConfigurationResult;
            expect(reserveConfiguration).toMatchObject(otherReserveConfiguration);
            expect(aTokenAddress.toString()).toEqual(reserveConfiguration.aTokenAddress.toString());
            expect(dTokenAddress.toString()).toEqual(reserveConfiguration.dTokenAddress.toString());
            expect(poolWalletAddress.toString()).toEqual(reserveConfiguration.poolWalletAddress.toString());
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
                },
            );
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
                liquidityIndex: 1n,
                borrowIndex: 1n,
                totalSupply: 0n,
                availableLiquidity: 0n,
                accruedToTreasury: 0n,
                totalBorrow: 0n,
                // ignore lastUpdateTimestamp
            });
        });

        it('should getReserveConfiguration', async () => {
            const result = await pool.getReserveConfiguration(reserveAddress);
            const { poolWalletAddress, aTokenAddress, dTokenAddress, ...otherReserveConfiguration } = result;
            expect(reserveConfiguration).toMatchObject(otherReserveConfiguration);
            expect(aTokenAddress.toString()).toEqual(reserveConfiguration.aTokenAddress.toString());
            expect(dTokenAddress.toString()).toEqual(reserveConfiguration.dTokenAddress.toString());
            expect(poolWalletAddress.toString()).toEqual(reserveConfiguration.poolWalletAddress.toString());
        });

        it('should getReservesLength', async () => {
            const result = await pool.getReservesLength();
            expect(result).toEqual(1n);
        });
    });
});

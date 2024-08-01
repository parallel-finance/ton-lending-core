import { Blockchain, BlockchainSnapshot, SandboxContract, Treasury, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, fromNano, toNano } from '@ton/core';
import { ATokenDTokenContents, Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { sleep } from '@ton/blueprint';
import { PERCENTAGE_FACTOR, RAY } from '../helpers/constant';
import { TestMathUtils } from '../wrappers/TestMathUtils';
import { AToken } from '../build/Pool/tact_AToken';
import { DToken } from '../build/Pool/tact_DToken';

describe('Pool indexes calculation', () => {
    let blockchain: Blockchain;
    let snapshot: BlockchainSnapshot;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let aToken: SandboxContract<AToken>;
    let dToken: SandboxContract<DToken>;
    let mathUtils: SandboxContract<TestMathUtils>;
    let addresses: any = {};

    let reserveConfiguration: ReserveConfiguration;
    let reserveInterestRateStrategy: ReserveInterestRateStrategy;
    let contents: ATokenDTokenContents;

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

        const jettonParams = {
            name: 'SampleJetton',
            description: 'Sample Jetton for testing purposes',
            decimals: '9',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'SAM',
        };
        let max_supply = toNano(1000000n); // 🔴 Set the specific total supply in nano
        let content = buildOnchainMetadata(jettonParams);
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
        contents = {
            $$type: 'ATokenDTokenContents',
            aTokenContent,
            dTokenContent: dTokenContent,
        };

        sampleJetton = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content, max_supply));

        await sampleJetton.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
        addresses.sampleJetton = sampleJetton.address;
        const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
        addresses.poolWalletAddress = poolWalletAddress;
        const aTokenAddress = await pool.getCalculateATokenAddress(contents.aTokenContent, sampleJetton.address);
        addresses.aTokenAddress = aTokenAddress;
        const dTokenAddress = await pool.getCalculateDTokenAddress(contents.dTokenContent, sampleJetton.address);
        addresses.dTokenAddress = dTokenAddress;
        reserveConfiguration = {
            $$type: 'ReserveConfiguration',
            poolWalletAddress,
            aTokenAddress,
            dTokenAddress,
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
            treasury: sampleJetton.address,
            decimals: 9n
        };

        // add reserve
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'AddReserve',
                reserveAddress: sampleJetton.address,
                reserveConfiguration,
                contents,
                reserveInterestRateStrategy,
            },
        );

        aToken = blockchain.openContract(AToken.fromAddress(addresses.aTokenAddress));
        dToken = blockchain.openContract(DToken.fromAddress(addresses.dTokenAddress));
        expect((await aToken.getOwner()).toString()).toEqual(pool.address.toString());
        expect((await aToken.getGetPoolData()).pool.toString()).toEqual(pool.address.toString());
        expect((await aToken.getGetPoolData()).asset.toString()).toEqual(sampleJetton.address.toString());

        // mint test jetton to deployer
        await sampleJetton.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Mint',
                queryId: 0n,
                amount: toNano(10000n),
                receiver: deployer.address,
            },
        );
        // mint test jetton to secondUser
        await sampleJetton.send(
            secondUser.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Mint',
                queryId: 0n,
                amount: toNano(10000n),
                receiver: secondUser.address,
            },
        );

        const rst = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetMockOraclePrice',
                asset: sampleJetton.address,
                price: toNano('1'),
            },
        );

        // SetMockOraclePrice
        expect(rst.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });

        mathUtils = blockchain.openContract(await TestMathUtils.fromInit());

        await mathUtils.send(
            deployer.getSender(),
            {
                value: toNano('0.02'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );
    });

    beforeEach(async () => {
        snapshot = blockchain.snapshot();
        // priceAddresses();
    });
    afterEach(async () => {
        await blockchain.loadFrom(snapshot);
    });

    const priceAddresses = () => {
        const printAddress: any = {};
        Object.entries(addresses).forEach(([key, value]) => {
            printAddress[key] = (value as Address).toString();
        });
        console.table(printAddress);
    };

    const supply = async (user: Treasury, amount: bigint) => {
        // transfer jetton to pool
        const userWalletAddress = await sampleJetton.getGetWalletAddress(user.address);
        const poolWalletAddress = addresses.poolWalletAddress;
        const userJettonDefaultWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(userWalletAddress));
        const forward_payload: Cell = beginCell().storeUint(0x55b591ba, 32).endCell();

        const userAccountContract = blockchain.openContract(await UserAccount.fromInit(pool.address, user.address));
        const userAccountAddress = userAccountContract.address;

        const result = await userJettonDefaultWallet.send(
            user,
            {
                value: toNano('3'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                amount: amount,
                destination: pool.address,
                response_destination: userWalletAddress,
                custom_payload: null,
                forward_ton_amount: toNano('2'),
                forward_payload: forward_payload,
            },
        );

        // TokenTransferInternal
        expect(result.transactions).toHaveTransaction({
            from: userWalletAddress,
            to: poolWalletAddress,
            success: true,
        });

        // TransferNotification
        expect(result.transactions).toHaveTransaction({
            from: poolWalletAddress,
            to: pool.address,
            success: true,
        });

        // UpdatePosition
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: userAccountAddress,
            success: true,
        });
    };

    const borrow = async (user: Treasury, amount: bigint) => {
        const userWalletAddress = await sampleJetton.getGetWalletAddress(user.address);
        const poolWalletAddress = addresses.poolWalletAddress;

        const userAccountAddress = await UserAccount.fromInit(pool.address, user.address);
        const result = await pool.send(
            user,
            {
                value: toNano('0.3'),
            },
            {
                $$type: 'BorrowToken',
                tokenAddress: sampleJetton.address,
                amount,
            },
        );

        // BorrowToken
        expect(result.transactions).toHaveTransaction({
            from: user.address,
            to: pool.address,
            success: true,
        });

        // GetUserAccountData
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: userAccountAddress.address,
            success: true,
        });

        // UserAccountDataResponse
        expect(result.transactions).toHaveTransaction({
            from: userAccountAddress.address,
            to: pool.address,
            success: true,
        });

        // UpdateUserAccountData
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: userAccountAddress.address,
            success: true,
        });

        // Mint dToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: addresses.dTokenAddress,
            success: true,
        });

        // Pool send the TransferToken message to the jetton contract
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: poolWalletAddress,
            success: true,
        });

        // Pool wallet transfer borrowed jetton to user
        expect(result.transactions).toHaveTransaction({
            from: poolWalletAddress,
            to: userWalletAddress,
            success: true,
        });
    };

    it('check LiquidityIndex and BorrowIndex', async () => {
        const supplyAmount = toNano(100n);

        await supply(deployer.getSender(), supplyAmount);
        let reserveData = (await pool.getReserveDataAndConfiguration(sampleJetton.address)).reserveData;
        // no debts, no rates
        expect(reserveData.liquidityIndex).toEqual(RAY);
        expect(reserveData.borrowIndex).toEqual(RAY);
        expect(reserveData.currentLiquidityRate).toEqual(0n);
        expect(reserveData.currentBorrowRate).toEqual(0n);

        await sleep(5 * 1000);

        reserveData = (await pool.getReserveDataAndConfiguration(sampleJetton.address)).reserveData;
        // no debts, no rates
        expect(reserveData.liquidityIndex).toEqual(RAY);
        expect(reserveData.borrowIndex).toEqual(RAY);
        expect(reserveData.currentLiquidityRate).toEqual(0n);
        expect(reserveData.currentBorrowRate).toEqual(0n);

        await supply(secondUser.getSender(), supplyAmount);
        reserveData = (await pool.getReserveDataAndConfiguration(sampleJetton.address)).reserveData;
        // no debts, no rates
        expect(reserveData.liquidityIndex).toEqual(RAY);
        expect(reserveData.borrowIndex).toEqual(RAY);
        expect(reserveData.currentLiquidityRate).toEqual(0n);
        expect(reserveData.currentBorrowRate).toEqual(0n);
        await sleep(5 * 1000);

        let reserveDataBefore = (await pool.getReserveDataAndConfiguration(sampleJetton.address)).reserveData;
        const borrowAmount = toNano(50n);
        await borrow(secondUser.getSender(), borrowAmount);
        await sleep(5 * 1000);
        const reserveDataAndConfiguration = await pool.getReserveDataAndConfiguration(sampleJetton.address);
        reserveData = reserveDataAndConfiguration.reserveData;
        // first borrow, the index still should be RAY, the rates should not be zero
        expect(reserveData.liquidityIndex).toEqual(RAY);
        expect(reserveData.borrowIndex).toEqual(RAY);
        // calculate rates
        {
            const totalDebt = (reserveData.totalBorrow * reserveData.borrowIndex) / RAY;
            // availableLiquidity decrease
            const availableLiquidity = reserveDataBefore.availableLiquidity - borrowAmount;
            const availableLiquidityPlusDebt = availableLiquidity + totalDebt;
            const borrowUsageRatio = (totalDebt * RAY) / availableLiquidityPlusDebt;
            const supplyUsageRatio = (totalDebt * RAY) / availableLiquidityPlusDebt;
            const currentBorrowRate =
                (reserveInterestRateStrategy.slope1 * borrowUsageRatio) / reserveInterestRateStrategy.optimalUsageRatio;
            const currentLiquidityRate =
                (((currentBorrowRate * supplyUsageRatio) / RAY) *
                    (PERCENTAGE_FACTOR - reserveConfiguration.reserveFactor)) /
                PERCENTAGE_FACTOR;
            expect(reserveData.currentLiquidityRate).toEqual(currentLiquidityRate);
            expect(reserveData.currentBorrowRate).toEqual(currentBorrowRate);
        }

        // non-zero debts, non-zero rates
        // normalizedIncome is the real-time liquidityIndex
        // normalizedDebt is the real-time borrowIndex
        expect(reserveDataAndConfiguration.normalizedIncome).toEqual(
            await mathUtils.getCalculateLinearInterest(
                reserveData.currentLiquidityRate,
                reserveData.lastUpdateTimestamp,
            ),
        );
        expect(reserveDataAndConfiguration.normalizedDebt).toEqual(
            await mathUtils.getCalculateCompoundedInterest(
                reserveData.currentBorrowRate,
                reserveData.lastUpdateTimestamp,
            ),
        );
        const normalizedIncomeBefore = reserveDataAndConfiguration.normalizedIncome;
        const normalizedDebtBefore = reserveDataAndConfiguration.normalizedDebt;
        reserveDataBefore = reserveData;
        await supply(deployer.getSender(), supplyAmount);
        await sleep(5 * 1000);
        reserveData = (await pool.getReserveDataAndConfiguration(sampleJetton.address)).reserveData;
        // after the first borrow, the other action will update the indexes.
        expect(Number(fromNano(reserveData.liquidityIndex))).toBeCloseTo(Number(fromNano(normalizedIncomeBefore)), -9);
        expect(Number(fromNano(reserveData.borrowIndex))).toBeCloseTo(Number(fromNano(normalizedDebtBefore)), -9);
        // calculate rates
        {
            const totalDebt = (reserveData.totalBorrow * reserveData.borrowIndex) / RAY;
            // availableLiquidity increase
            const availableLiquidity = reserveDataBefore.availableLiquidity + supplyAmount;
            const availableLiquidityPlusDebt = availableLiquidity + totalDebt;
            const borrowUsageRatio = (totalDebt * RAY) / availableLiquidityPlusDebt;
            const supplyUsageRatio = (totalDebt * RAY) / availableLiquidityPlusDebt;
            const currentBorrowRate =
                (reserveInterestRateStrategy.slope1 * borrowUsageRatio) / reserveInterestRateStrategy.optimalUsageRatio;
            const currentLiquidityRate =
                (((currentBorrowRate * supplyUsageRatio) / RAY) *
                    (PERCENTAGE_FACTOR - reserveConfiguration.reserveFactor)) /
                PERCENTAGE_FACTOR;
            expect(Number(fromNano(reserveData.currentLiquidityRate))).toBeCloseTo(Number(fromNano(currentLiquidityRate)), -9);
            expect(Number(fromNano(reserveData.currentBorrowRate))).toBeCloseTo(Number(fromNano(currentBorrowRate)), -9);
        }

        //  check: totalSupplyInUnderlying, available liquidity, totalBorrowInUnderlying, accToTreasury
        const totalSupplyInUnderlying = (reserveData.totalSupply * reserveData.liquidityIndex) / RAY;
        const totalBorrowInUnderlying = (reserveData.totalBorrow * reserveData.borrowIndex) / RAY;
        const accToTreasury = (reserveData.accruedToTreasury * reserveData.liquidityIndex) / RAY;
        expect(Number(fromNano(totalSupplyInUnderlying + accToTreasury))).toBeCloseTo(
            Number(fromNano(totalBorrowInUnderlying + reserveData.availableLiquidity)),
            7,
        );
    });
});

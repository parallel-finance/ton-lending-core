import { Blockchain, BlockchainSnapshot, SandboxContract, Treasury, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, fromNano, toNano } from '@ton/core';
import { ATokenDTokenContents, Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { PERCENTAGE_FACTOR, RAY } from '../helpers/constant';
import { TestMathUtils } from '../wrappers/TestMathUtils';
import { DTokenDefaultWallet } from '../build/Pool/tact_DTokenDefaultWallet';
import { ATokenDefaultWallet } from '../build/Pool/tact_ATokenDefaultWallet';
import { AToken } from '../build/Pool/tact_AToken';
import { DToken } from '../build/Pool/tact_DToken';
import { addReserve, deployPool } from './utils';
import { flattenTransaction } from '@ton/test-utils';

describe('Pool liquidation test', () => {
    let blockchain: Blockchain;
    let snapshot: BlockchainSnapshot;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton1: SandboxContract<SampleJetton>;
    let sampleJetton2: SandboxContract<SampleJetton>;
    let aToken1: SandboxContract<AToken>;
    let aToken2: SandboxContract<AToken>;
    let dToken1: SandboxContract<DToken>;
    let dToken2: SandboxContract<DToken>;
    let mathUtils: SandboxContract<TestMathUtils>;
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
        await deployPool(pool, deployer);
        addresses.pool = pool.address;

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

        addresses.poolWalletAddress1 = poolWalletAddress1;
        addresses.poolWalletAddress2 = poolWalletAddress2;
        addresses.aTokenAddress1 = aTokenAddress1;
        addresses.aTokenAddress2 = aTokenAddress2;
        addresses.dTokenAddress1 = dTokenAddress1;
        addresses.dTokenAddress2 = dTokenAddress2;
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

        aToken1 = blockchain.openContract(AToken.fromAddress(addresses.aTokenAddress1));
        dToken1 = blockchain.openContract(DToken.fromAddress(addresses.dTokenAddress1));
        expect((await aToken1.getOwner()).toString()).toEqual(pool.address.toString());
        expect((await aToken1.getGetPoolData()).pool.toString()).toEqual(pool.address.toString());
        expect((await aToken1.getGetPoolData()).asset.toString()).toEqual(sampleJetton1.address.toString());

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

        aToken2 = blockchain.openContract(AToken.fromAddress(addresses.aTokenAddress2));
        dToken2 = blockchain.openContract(DToken.fromAddress(addresses.dTokenAddress2));
        expect((await aToken2.getOwner()).toString()).toEqual(pool.address.toString());
        expect((await aToken2.getGetPoolData()).pool.toString()).toEqual(pool.address.toString());
        expect((await aToken2.getGetPoolData()).asset.toString()).toEqual(sampleJetton2.address.toString());

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
        priceAddresses();
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

    const configureReserveAsCollateral = async (
        jetton: Address,
        config: {
            ltv: bigint;
            liquidationThreshold: bigint;
            liquidationBonus: bigint;
        },
    ) => {
        const rst = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'ConfigureReserveAsCollateral',
                reserve: jetton,
                ltv: config.ltv,
                liquidationThreshold: config.liquidationThreshold,
                liquidationBonus: config.liquidationBonus,
            },
        );
        expect(rst.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        const configuration = await pool.getReserveConfiguration(jetton);

        expect(configuration.ltv).toEqual(config.ltv);
        expect(configuration.liquidationThreshold).toEqual(config.liquidationThreshold);
        expect(configuration.liquidationBonus).toEqual(config.liquidationBonus);
    };

    const supply = async (user: Treasury, jetton: SandboxContract<SampleJetton>, amount: bigint) => {
        // transfer jetton to pool
        const userWalletAddress = await jetton.getGetWalletAddress(user.address);
        const [poolWalletAddress, aTokenAddress] =
            jetton.address.toString() === sampleJetton1.address.toString()
                ? [addresses.poolWalletAddress1, addresses.aTokenAddress1]
                : [addresses.poolWalletAddress2, addresses.aTokenAddress2];
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

        // userPositionUpdated
        expect(result.transactions).toHaveTransaction({
            from: userAccountAddress,
            to: pool.address,
            success: true,
        });

        // Mint aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: aTokenAddress,
            success: true,
        });
    };

    const borrow = async (user: Treasury, jetton: SandboxContract<SampleJetton>, amount: bigint) => {
        const userWalletAddress = await jetton.getGetWalletAddress(user.address);
        const [poolWalletAddress, dTokenAddress] =
            jetton.address.toString() === sampleJetton1.address.toString()
                ? [addresses.poolWalletAddress1, addresses.dTokenAddress1]
                : [addresses.poolWalletAddress2, addresses.dTokenAddress2];

        const userAccountAddress = await UserAccount.fromInit(pool.address, user.address);
        const result = await pool.send(
            user,
            {
                value: toNano('0.45'),
            },
            {
                $$type: 'BorrowToken',
                tokenAddress: jetton.address,
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
            to: dTokenAddress,
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

    it('supply jetton1, borrow jetton2, closeFactor: 100%', async () => {
        // provide liquidity
        await supply(secondUser.getSender(), sampleJetton1, 10000n * 10n ** reserveConfiguration1.decimals);
        await supply(secondUser.getSender(), sampleJetton2, 10000n * 10n ** reserveConfiguration2.decimals);

        // borrower supply jetton1 and borrow jetton2
        const borrower = deployer;
        const collateralReserve = sampleJetton1;
        const debtReserve = sampleJetton2;
        const collateralUint = 10n ** reserveConfiguration1.decimals;
        const debtUint = 10n ** reserveConfiguration2.decimals;
        const supplyAmount = 10000n * collateralUint;
        const borrowAmount = 5000n * debtUint;
        await supply(deployer.getSender(), collateralReserve, supplyAmount);
        await borrow(deployer.getSender(), debtReserve, borrowAmount);
        const borrowerAccount = blockchain.openContract(await UserAccount.fromInit(pool.address, borrower.address));

        let accountData = await borrowerAccount.getAccount();
        let borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        let collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        let debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(2n);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.borrow).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.supply).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            5,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            4,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // change debt asset price to shortfall borrower
        await setMockOraclePrice(debtReserve.address, toNano('2'));

        accountData = await borrowerAccount.getAccount();
        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);
        collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(2n);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.borrow).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.supply).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            2,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            2,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // send liquidation message
        const liquidator = secondUser;
        const liquidatorDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(liquidator.address)),
        );
        const poolDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(pool.address)),
        );
        const poolCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(pool.address)),
        );
        const liquidatorCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(liquidator.address)),
        );
        const liquidatorCollateralWalletBalanceBefore = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        const treasuryCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(
                await collateralReserve.getGetWalletAddress(collateralReserveData.reserveConfiguration.treasury),
            ),
        );
        const borrowerDTokenWallet = blockchain.openContract(
            DTokenDefaultWallet.fromAddress(await dToken2.getGetWalletAddress(borrower.address)),
        );
        const borrowerATokenWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken1.getGetWalletAddress(borrower.address)),
        );

        const forward_payload: Cell = beginCell()
            .storeUint(0x1f03e59a, 32) // Liquidate opcode: 0x1f03e59a
            .storeAddress(borrower.address) // borrower
            .storeUint(0, 5) // collateral reserve Index
            .endCell();

        const debtAmount =
            accountData.positionsDetail.get(debtReserve.address)?.borrow || (0n * debtReserveData.normalizedDebt) / RAY;
        const collateralAmount =
            accountData.positionsDetail.get(collateralReserve.address)?.supply ||
            (0n * collateralReserveData.normalizedIncome) / RAY;
        const closeFactor = Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY) > 0.95 ? 5000n : 10000n;
        let actualLiquidationAmount = (debtAmount * closeFactor) / PERCENTAGE_FACTOR;

        const maxCollateralToLiquidate =
            (((debtReserveData.reserveData.price * actualLiquidationAmount * collateralUint) /
                (collateralReserveData.reserveData.price * debtUint)) *
                collateralReserveData.reserveConfiguration.liquidationBonus) /
            PERCENTAGE_FACTOR;
        let actualCollateralToLiquidate = 0n;
        if (maxCollateralToLiquidate > collateralAmount) {
            actualCollateralToLiquidate = collateralAmount;
            actualLiquidationAmount =
                (((collateralReserveData.reserveData.price * actualCollateralToLiquidate * debtUint) /
                    (debtReserveData.reserveData.price * collateralUint)) *
                    PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        } else {
            actualCollateralToLiquidate = maxCollateralToLiquidate;
            actualLiquidationAmount = actualLiquidationAmount;
        }
        const expectedCollateralAfter =
            borrowerHealthInfo.totalSupplyInBaseCurrency -
            (actualCollateralToLiquidate * collateralReserveData.reserveData.price) / collateralUint;
        const expectedDebtAfter =
            borrowerHealthInfo.totalDebtInBaseCurrency -
            (actualLiquidationAmount * debtReserveData.reserveData.price) / debtUint;

        let bonusCollateral =
            actualCollateralToLiquidate -
            (actualCollateralToLiquidate * PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        let liquidationProtocolFee =
            (bonusCollateral * collateralReserveData.reserveConfiguration.liquidationProtocolFee) / PERCENTAGE_FACTOR;

        let result = await liquidatorDebtReserveWallet.send(
            liquidator.getSender(),
            {
                value: toNano('10'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                amount: debtAmount,
                destination: pool.address,
                response_destination: liquidatorDebtReserveWallet.address,
                custom_payload: null,
                forward_ton_amount: toNano('4.1'),
                forward_payload: forward_payload,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: liquidatorDebtReserveWallet.address,
            to: poolDebtReserveWallet.address,
            success: true,
        });
        // TokenNotification
        expect(result.transactions).toHaveTransaction({
            from: poolDebtReserveWallet.address,
            to: pool.address,
            success: true,
        });
        // GetUserAccountData
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // UserAccountDataResponse
        expect(result.transactions).toHaveTransaction({
            from: borrowerAccount.address,
            to: pool.address,
            success: true,
        });
        // UpdatePosition debt token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn dToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerDTokenWallet.address,
            success: true,
        });
        // UpdatePosition collateral token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerATokenWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: liquidatorCollateralWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: treasuryCollateralWallet.address,
            success: true,
        });

        accountData = await borrowerAccount.getAccount();

        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        // check borrower positions
        expect(Number(expectedCollateralAfter)).toBeCloseTo(
            Number(borrowerHealthInfo.totalSupplyInBaseCurrency),
            -5,
        );
        expect(Number(expectedDebtAfter)).toBeCloseTo(Number(borrowerHealthInfo.totalDebtInBaseCurrency), -5);
        const dTokenBalance = (await borrowerDTokenWallet.getGetWalletData()).balance;
        const aTokenBalance = (await borrowerATokenWallet.getGetWalletData()).balance;
        expect(dTokenBalance).toEqual(accountData.positionsDetail.get(debtReserve.address)?.borrow);
        expect(aTokenBalance).toEqual(accountData.positionsDetail.get(collateralReserve.address)?.supply);
        // check treasury collateral balance
        const treasuryCollateralWalletBalance = (await treasuryCollateralWallet.getGetWalletData()).balance;
        expect(Number(treasuryCollateralWalletBalance)).toBeCloseTo(Number(liquidationProtocolFee), -1);
        // check liquidator collateral balance
        const liquidatorCollateralWalletBalanceAfter = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        expect(
            Number(liquidatorCollateralWalletBalanceBefore + actualCollateralToLiquidate - liquidationProtocolFee),
        ).toBeCloseTo(Number(liquidatorCollateralWalletBalanceAfter), -1);
    });

    it('supply jetton1, borrow jetton2, closeFactor: 50%', async () => {
        // provide liquidity
        await supply(secondUser.getSender(), sampleJetton1, 10000n * 10n ** reserveConfiguration1.decimals);
        await supply(secondUser.getSender(), sampleJetton2, 10000n * 10n ** reserveConfiguration2.decimals);

        // borrower supply jetton1 and borrow jetton2
        const borrower = deployer;
        const collateralReserve = sampleJetton1;
        const debtReserve = sampleJetton2;
        const collateralUint = 10n ** reserveConfiguration1.decimals;
        const debtUint = 10n ** reserveConfiguration2.decimals;
        const supplyAmount = 10000n * collateralUint;
        const borrowAmount = 5000n * debtUint;
        await supply(deployer.getSender(), collateralReserve, supplyAmount);
        await borrow(deployer.getSender(), debtReserve, borrowAmount);
        const borrowerAccount = blockchain.openContract(await UserAccount.fromInit(pool.address, borrower.address));

        let accountData = await borrowerAccount.getAccount();
        let borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        let collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        let debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(2n);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.borrow).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.supply).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            5,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            5,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // change debt asset price to shortfall borrower
        await setMockOraclePrice(debtReserve.address, toNano('1.55'));

        accountData = await borrowerAccount.getAccount();
        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);
        collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(2n);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.borrow).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.supply).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            2,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            2,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // send liquidation message
        const liquidator = secondUser;
        const liquidatorDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(liquidator.address)),
        );
        const poolDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(pool.address)),
        );
        const poolCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(pool.address)),
        );
        const liquidatorCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(liquidator.address)),
        );
        const liquidatorCollateralWalletBalanceBefore = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        const treasuryCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(
                await collateralReserve.getGetWalletAddress(collateralReserveData.reserveConfiguration.treasury),
            ),
        );
        const borrowerDTokenWallet = blockchain.openContract(
            DTokenDefaultWallet.fromAddress(await dToken2.getGetWalletAddress(borrower.address)),
        );
        const borrowerATokenWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken1.getGetWalletAddress(borrower.address)),
        );

        const forward_payload: Cell = beginCell()
            .storeUint(0x1f03e59a, 32) // Liquidate opcode: 0x1f03e59a
            .storeAddress(borrower.address) // borrower
            .storeUint(0, 5) // collateral reserve Index
            .endCell();

        const debtAmount =
            accountData.positionsDetail.get(debtReserve.address)?.borrow || (0n * debtReserveData.normalizedDebt) / RAY;
        const collateralAmount =
            accountData.positionsDetail.get(collateralReserve.address)?.supply ||
            (0n * collateralReserveData.normalizedIncome) / RAY;
        const closeFactor = Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY) > 0.95 ? 5000n : 10000n;
        let actualLiquidationAmount = (debtAmount * closeFactor) / PERCENTAGE_FACTOR;

        const maxCollateralToLiquidate =
            (((debtReserveData.reserveData.price * actualLiquidationAmount * collateralUint) /
                (collateralReserveData.reserveData.price * debtUint)) *
                collateralReserveData.reserveConfiguration.liquidationBonus) /
            PERCENTAGE_FACTOR;
        let actualCollateralToLiquidate = 0n;
        if (maxCollateralToLiquidate > collateralAmount) {
            actualCollateralToLiquidate = collateralAmount;
            actualLiquidationAmount =
                (((collateralReserveData.reserveData.price * actualCollateralToLiquidate * debtUint) /
                    (debtReserveData.reserveData.price * collateralUint)) *
                    PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        } else {
            actualCollateralToLiquidate = maxCollateralToLiquidate;
            actualLiquidationAmount = actualLiquidationAmount;
        }
        const expectedCollateralAfter =
            borrowerHealthInfo.totalSupplyInBaseCurrency -
            (actualCollateralToLiquidate * collateralReserveData.reserveData.price) / collateralUint;
        const expectedDebtAfter =
            borrowerHealthInfo.totalDebtInBaseCurrency -
            (actualLiquidationAmount * debtReserveData.reserveData.price) / debtUint;

        let bonusCollateral =
            actualCollateralToLiquidate -
            (actualCollateralToLiquidate * PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        let liquidationProtocolFee =
            (bonusCollateral * collateralReserveData.reserveConfiguration.liquidationProtocolFee) / PERCENTAGE_FACTOR;

        let result = await liquidatorDebtReserveWallet.send(
            liquidator.getSender(),
            {
                value: toNano('10'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                amount: debtAmount,
                destination: pool.address,
                response_destination: liquidatorDebtReserveWallet.address,
                custom_payload: null,
                forward_ton_amount: toNano('4.1'),
                forward_payload: forward_payload,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: liquidatorDebtReserveWallet.address,
            to: poolDebtReserveWallet.address,
            success: true,
        });
        // TokenNotification
        expect(result.transactions).toHaveTransaction({
            from: poolDebtReserveWallet.address,
            to: pool.address,
            success: true,
        });
        // GetUserAccountData
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // UserAccountDataResponse
        expect(result.transactions).toHaveTransaction({
            from: borrowerAccount.address,
            to: pool.address,
            success: true,
        });
        // UpdatePosition debt token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn dToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerDTokenWallet.address,
            success: true,
        });
        // UpdatePosition collateral token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerATokenWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: liquidatorCollateralWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: treasuryCollateralWallet.address,
            success: true,
        });

        accountData = await borrowerAccount.getAccount();

        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        // check borrower positions
        expect(Number(expectedCollateralAfter)).toBeCloseTo(
            Number(borrowerHealthInfo.totalSupplyInBaseCurrency),
            -5,
        );
        expect(Number(expectedDebtAfter)).toBeCloseTo(Number(borrowerHealthInfo.totalDebtInBaseCurrency), -5);
        const dTokenBalance = (await borrowerDTokenWallet.getGetWalletData()).balance;
        const aTokenBalance = (await borrowerATokenWallet.getGetWalletData()).balance;
        expect(dTokenBalance).toEqual(accountData.positionsDetail.get(debtReserve.address)?.borrow);
        expect(aTokenBalance).toEqual(accountData.positionsDetail.get(collateralReserve.address)?.supply);
        // check treasury collateral balance
        const treasuryCollateralWalletBalance = (await treasuryCollateralWallet.getGetWalletData()).balance;
        expect(Number(treasuryCollateralWalletBalance)).toBeCloseTo(Number(liquidationProtocolFee), -2);
        // check liquidator collateral balance
        const liquidatorCollateralWalletBalanceAfter = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        expect(
            Number(liquidatorCollateralWalletBalanceBefore + actualCollateralToLiquidate - liquidationProtocolFee),
        ).toBeCloseTo(Number(liquidatorCollateralWalletBalanceAfter), -5);
    });

    it('supply jetton1, borrow jetton1, closeFactor: 50%', async () => {
        // provide liquidity
        await supply(secondUser.getSender(), sampleJetton1, 10000n * 10n ** reserveConfiguration1.decimals);
        await supply(secondUser.getSender(), sampleJetton2, 10000n * 10n ** reserveConfiguration2.decimals);

        // borrower supply jetton1 and borrow jetton1
        const borrower = deployer;
        const collateralReserve = sampleJetton1;
        const debtReserve = sampleJetton1;
        const collateralUint = 10n ** reserveConfiguration1.decimals;
        const debtUint = 10n ** reserveConfiguration1.decimals;
        const supplyAmount = 10000n * collateralUint;
        const borrowAmount = 5990n * debtUint;
        await supply(deployer.getSender(), collateralReserve, supplyAmount);
        await borrow(deployer.getSender(), debtReserve, borrowAmount);
        const borrowerAccount = blockchain.openContract(await UserAccount.fromInit(pool.address, borrower.address));

        let accountData = await borrowerAccount.getAccount();
        let borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        let collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        let debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(1n);
        
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            5,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            5,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // update borrow asset LS to shortfall borrower
        await configureReserveAsCollateral(collateralReserve.address, {
            ltv: 5000n,
            liquidationBonus: reserveConfiguration1.liquidationBonus,
            liquidationThreshold: 5900n,
        });

        accountData = await borrowerAccount.getAccount();
        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);
        collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(1n);
        
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            2,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            2,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // send liquidation message
        const liquidator = secondUser;
        const liquidatorDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(liquidator.address)),
        );
        const poolDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(pool.address)),
        );
        const poolCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(pool.address)),
        );
        const liquidatorCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(liquidator.address)),
        );
        const liquidatorCollateralWalletBalanceBefore = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        const treasuryCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(
                await collateralReserve.getGetWalletAddress(collateralReserveData.reserveConfiguration.treasury),
            ),
        );
        const borrowerDTokenWallet = blockchain.openContract(
            DTokenDefaultWallet.fromAddress(await dToken1.getGetWalletAddress(borrower.address)),
        );
        const borrowerATokenWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken1.getGetWalletAddress(borrower.address)),
        );

        const forward_payload: Cell = beginCell()
            .storeUint(0x1f03e59a, 32) // Liquidate opcode: 0x1f03e59a
            .storeAddress(borrower.address) // borrower
            .storeUint(0, 5) // collateral reserve Index
            .endCell();

        const debtAmount =
            accountData.positionsDetail.get(debtReserve.address)?.borrow || (0n * debtReserveData.normalizedDebt) / RAY;
        const collateralAmount =
            accountData.positionsDetail.get(collateralReserve.address)?.supply ||
            (0n * collateralReserveData.normalizedIncome) / RAY;
        const closeFactor = Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY) > 0.95 ? 5000n : 10000n;
        let actualLiquidationAmount = (debtAmount * closeFactor) / PERCENTAGE_FACTOR;

        const maxCollateralToLiquidate =
            (((debtReserveData.reserveData.price * actualLiquidationAmount * collateralUint) /
                (collateralReserveData.reserveData.price * debtUint)) *
                collateralReserveData.reserveConfiguration.liquidationBonus) /
            PERCENTAGE_FACTOR;
        let actualCollateralToLiquidate = 0n;
        if (maxCollateralToLiquidate > collateralAmount) {
            actualCollateralToLiquidate = collateralAmount;
            actualLiquidationAmount =
                (((collateralReserveData.reserveData.price * actualCollateralToLiquidate * debtUint) /
                    (debtReserveData.reserveData.price * collateralUint)) *
                    PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        } else {
            actualCollateralToLiquidate = maxCollateralToLiquidate;
            actualLiquidationAmount = actualLiquidationAmount;
        }
        const expectedCollateralAfter =
            borrowerHealthInfo.totalSupplyInBaseCurrency -
            (actualCollateralToLiquidate * collateralReserveData.reserveData.price) / collateralUint;
        const expectedDebtAfter =
            borrowerHealthInfo.totalDebtInBaseCurrency -
            (actualLiquidationAmount * debtReserveData.reserveData.price) / debtUint;

        let bonusCollateral =
            actualCollateralToLiquidate -
            (actualCollateralToLiquidate * PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        let liquidationProtocolFee =
            (bonusCollateral * collateralReserveData.reserveConfiguration.liquidationProtocolFee) / PERCENTAGE_FACTOR;

        let result = await liquidatorDebtReserveWallet.send(
            liquidator.getSender(),
            {
                value: toNano('10'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                amount: debtAmount,
                destination: pool.address,
                response_destination: liquidatorDebtReserveWallet.address,
                custom_payload: null,
                forward_ton_amount: toNano('4.1'),
                forward_payload: forward_payload,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: liquidatorDebtReserveWallet.address,
            to: poolDebtReserveWallet.address,
            success: true,
        });
        // TokenNotification
        expect(result.transactions).toHaveTransaction({
            from: poolDebtReserveWallet.address,
            to: pool.address,
            success: true,
        });
        // GetUserAccountData
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // UserAccountDataResponse
        expect(result.transactions).toHaveTransaction({
            from: borrowerAccount.address,
            to: pool.address,
            success: true,
        });
        // UpdatePosition debt token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn dToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerDTokenWallet.address,
            success: true,
        });
        // UpdatePosition collateral token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerATokenWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: liquidatorCollateralWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: treasuryCollateralWallet.address,
            success: true,
        });

        accountData = await borrowerAccount.getAccount();

        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        // check borrower positions
        expect(Number(expectedCollateralAfter)).toBeCloseTo(
            Number(borrowerHealthInfo.totalSupplyInBaseCurrency),
            -5,
        );
        expect(Number(expectedDebtAfter)).toBeCloseTo(Number(borrowerHealthInfo.totalDebtInBaseCurrency), -5);
        const dTokenBalance = (await borrowerDTokenWallet.getGetWalletData()).balance;
        const aTokenBalance = (await borrowerATokenWallet.getGetWalletData()).balance;
        expect(dTokenBalance).toEqual(accountData.positionsDetail.get(debtReserve.address)?.borrow);
        expect(aTokenBalance).toEqual(accountData.positionsDetail.get(collateralReserve.address)?.supply);
        // check treasury collateral balance
        const treasuryCollateralWalletBalance = (await treasuryCollateralWallet.getGetWalletData()).balance;
        expect(Number(treasuryCollateralWalletBalance)).toBeCloseTo(Number(liquidationProtocolFee), -2);
        // check liquidator collateral balance
        const liquidatorCollateralWalletBalanceAfter = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        expect(
            Number(
                liquidatorCollateralWalletBalanceBefore -
                    debtAmount +
                    actualCollateralToLiquidate -
                    liquidationProtocolFee,
            ),
        ).toBeCloseTo(Number(liquidatorCollateralWalletBalanceAfter), -5);
    });

    it('supply jetton1, borrow jetton1, closeFactor: 100%', async () => {
        // provide liquidity
        await supply(secondUser.getSender(), sampleJetton1, 10000n * 10n ** reserveConfiguration1.decimals);
        await supply(secondUser.getSender(), sampleJetton2, 10000n * 10n ** reserveConfiguration2.decimals);

        // borrower supply jetton1 and borrow jetton1
        const borrower = deployer;
        const collateralReserve = sampleJetton1;
        const debtReserve = sampleJetton1;
        const collateralUint = 10n ** reserveConfiguration1.decimals;
        const debtUint = 10n ** reserveConfiguration1.decimals;
        const supplyAmount = 10000n * collateralUint;
        const borrowAmount = 5990n * debtUint;
        await supply(deployer.getSender(), collateralReserve, supplyAmount);
        await borrow(deployer.getSender(), debtReserve, borrowAmount);
        const borrowerAccount = blockchain.openContract(await UserAccount.fromInit(pool.address, borrower.address));

        let accountData = await borrowerAccount.getAccount();
        let borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        let collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        let debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(1n);
        
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            5,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            5,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // update borrow asset LS to shortfall borrower
        await configureReserveAsCollateral(collateralReserve.address, {
            ltv: 4000n,
            liquidationBonus: reserveConfiguration1.liquidationBonus,
            liquidationThreshold: 5000n,
        });

        accountData = await borrowerAccount.getAccount();
        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);
        collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(1n);
        
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            2,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            2,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // send liquidation message
        const liquidator = secondUser;
        const liquidatorDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(liquidator.address)),
        );
        const poolDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(pool.address)),
        );
        const poolCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(pool.address)),
        );
        const liquidatorCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(liquidator.address)),
        );
        const liquidatorCollateralWalletBalanceBefore = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        const treasuryCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(
                await collateralReserve.getGetWalletAddress(collateralReserveData.reserveConfiguration.treasury),
            ),
        );
        const borrowerDTokenWallet = blockchain.openContract(
            DTokenDefaultWallet.fromAddress(await dToken1.getGetWalletAddress(borrower.address)),
        );
        const borrowerATokenWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken1.getGetWalletAddress(borrower.address)),
        );

        const forward_payload: Cell = beginCell()
            .storeUint(0x1f03e59a, 32) // Liquidate opcode: 0x1f03e59a
            .storeAddress(borrower.address) // borrower
            .storeUint(0, 5) // collateral reserve Index
            .endCell();

        const debtAmount =
            accountData.positionsDetail.get(debtReserve.address)?.borrow || (0n * debtReserveData.normalizedDebt) / RAY;
        const collateralAmount =
            accountData.positionsDetail.get(collateralReserve.address)?.supply ||
            (0n * collateralReserveData.normalizedIncome) / RAY;
        const closeFactor = Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY) > 0.95 ? 5000n : 10000n;
        let actualLiquidationAmount = (debtAmount * closeFactor) / PERCENTAGE_FACTOR;

        const maxCollateralToLiquidate =
            (((debtReserveData.reserveData.price * actualLiquidationAmount * collateralUint) /
                (collateralReserveData.reserveData.price * debtUint)) *
                collateralReserveData.reserveConfiguration.liquidationBonus) /
            PERCENTAGE_FACTOR;
        let actualCollateralToLiquidate = 0n;
        if (maxCollateralToLiquidate > collateralAmount) {
            actualCollateralToLiquidate = collateralAmount;
            actualLiquidationAmount =
                (((collateralReserveData.reserveData.price * actualCollateralToLiquidate * debtUint) /
                    (debtReserveData.reserveData.price * collateralUint)) *
                    PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        } else {
            actualCollateralToLiquidate = maxCollateralToLiquidate;
            actualLiquidationAmount = actualLiquidationAmount;
        }
        const expectedCollateralAfter =
            borrowerHealthInfo.totalSupplyInBaseCurrency -
            (actualCollateralToLiquidate * collateralReserveData.reserveData.price) / collateralUint;
        const expectedDebtAfter =
            borrowerHealthInfo.totalDebtInBaseCurrency -
            (actualLiquidationAmount * debtReserveData.reserveData.price) / debtUint;

        let bonusCollateral =
            actualCollateralToLiquidate -
            (actualCollateralToLiquidate * PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        let liquidationProtocolFee =
            (bonusCollateral * collateralReserveData.reserveConfiguration.liquidationProtocolFee) / PERCENTAGE_FACTOR;

        let result = await liquidatorDebtReserveWallet.send(
            liquidator.getSender(),
            {
                value: toNano('10'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                amount: debtAmount,
                destination: pool.address,
                response_destination: liquidatorDebtReserveWallet.address,
                custom_payload: null,
                forward_ton_amount: toNano('4.1'),
                forward_payload: forward_payload,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: liquidatorDebtReserveWallet.address,
            to: poolDebtReserveWallet.address,
            success: true,
        });
        // TokenNotification
        expect(result.transactions).toHaveTransaction({
            from: poolDebtReserveWallet.address,
            to: pool.address,
            success: true,
        });
        // GetUserAccountData
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // UserAccountDataResponse
        expect(result.transactions).toHaveTransaction({
            from: borrowerAccount.address,
            to: pool.address,
            success: true,
        });
        // UpdatePosition debt token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn dToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerDTokenWallet.address,
            success: true,
        });
        // UpdatePosition collateral token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerATokenWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: liquidatorCollateralWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: treasuryCollateralWallet.address,
            success: true,
        });

        accountData = await borrowerAccount.getAccount();

        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        // check borrower positions
        expect(Number(expectedCollateralAfter)).toBeCloseTo(
            Number(borrowerHealthInfo.totalSupplyInBaseCurrency),
            -5,
        );
        expect(Number(expectedDebtAfter)).toBeCloseTo(Number(borrowerHealthInfo.totalDebtInBaseCurrency), -5);
        const dTokenBalance = (await borrowerDTokenWallet.getGetWalletData()).balance;
        const aTokenBalance = (await borrowerATokenWallet.getGetWalletData()).balance;
        expect(dTokenBalance).toEqual(accountData.positionsDetail.get(debtReserve.address)?.borrow);
        expect(aTokenBalance).toEqual(accountData.positionsDetail.get(collateralReserve.address)?.supply);
        // check treasury collateral balance
        const treasuryCollateralWalletBalance = (await treasuryCollateralWallet.getGetWalletData()).balance;
        expect(treasuryCollateralWalletBalance).toEqual(liquidationProtocolFee);
        // check liquidator collateral balance
        const liquidatorCollateralWalletBalanceAfter = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        expect(
            Number(
                liquidatorCollateralWalletBalanceBefore -
                    debtAmount +
                    actualCollateralToLiquidate -
                    liquidationProtocolFee,
            ),
        ).toBeCloseTo(Number(liquidatorCollateralWalletBalanceAfter), -5);
    });

    it('supply Ton, borrow jetton2, closeFactor: 100%', async () => {
        const { aTokenAddress } = await addReserve(pool, deployer, pool.address, pool.address);
        await setMockOraclePrice(pool.address, toNano(1));

        expect(await pool.getReservesLength()).toEqual(3n);

        const amount = toNano(100);
        let result = await pool.send(
            secondUser.getSender(),
            {
                value: amount + toNano(1),
            },
            {
                $$type: 'SupplyTon',
                amount,
            },
        );

        // provide liquidity
        await supply(secondUser.getSender(), sampleJetton2, 10000n * 10n ** reserveConfiguration2.decimals);

        // borrower supply jetton1 and borrow jetton2
        const borrower = deployer;
        const collateralReserve = pool;
        const debtReserve = sampleJetton2;
        const collateralUint = 10n ** 9n;
        const debtUint = 10n ** reserveConfiguration2.decimals;
        const supplyAmount = 10000n * collateralUint;
        const borrowAmount = 5000n * debtUint;
        await pool.send(
            deployer.getSender(),
            {
                value: supplyAmount + toNano('1'),
            },
            {
                $$type: 'SupplyTon',
                amount: supplyAmount,
            },
        );
        const borrowerAccount = blockchain.openContract(await UserAccount.fromInit(pool.address, borrower.address));

        await borrow(deployer.getSender(), debtReserve, borrowAmount);

        let accountData = await borrowerAccount.getAccount();
        let borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        let collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        let debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(2n);
        
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.borrow).toEqual(0n);
        
        expect(accountData.positionsDetail.get(debtReserve.address)?.supply).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            5,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            4,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // change debt asset price to shortfall borrower
        await setMockOraclePrice(debtReserve.address, toNano('2'));

        accountData = await borrowerAccount.getAccount();
        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);
        collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(2n);
        
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.borrow).toEqual(0n);
        
        expect(accountData.positionsDetail.get(debtReserve.address)?.supply).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            2,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            2,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // send liquidation message
        const liquidator = secondUser;
        const liquidatorDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(liquidator.address)),
        );
        const poolDebtReserveWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(pool.address)),
        );
        const borrowerDTokenWallet = blockchain.openContract(
            DTokenDefaultWallet.fromAddress(await dToken2.getGetWalletAddress(borrower.address)),
        );
        const aToken = blockchain.openContract(AToken.fromAddress(aTokenAddress));
        const borrowerATokenWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken.getGetWalletAddress(borrower.address)),
        );

        const forward_payload: Cell = beginCell()
            .storeUint(0x1f03e59a, 32) // Liquidate opcode: 0x1f03e59a
            .storeAddress(borrower.address) // borrower
            .storeUint(2, 5) // collateral reserve Index
            .endCell();

        const debtAmount =
            accountData.positionsDetail.get(debtReserve.address)?.borrow || (0n * debtReserveData.normalizedDebt) / RAY;
        const collateralAmount =
            accountData.positionsDetail.get(collateralReserve.address)?.supply ||
            (0n * collateralReserveData.normalizedIncome) / RAY;
        const closeFactor = Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY) > 0.95 ? 5000n : 10000n;
        let actualLiquidationAmount = (debtAmount * closeFactor) / PERCENTAGE_FACTOR;

        const maxCollateralToLiquidate =
            (((debtReserveData.reserveData.price * actualLiquidationAmount * collateralUint) /
                (collateralReserveData.reserveData.price * debtUint)) *
                collateralReserveData.reserveConfiguration.liquidationBonus) /
            PERCENTAGE_FACTOR;
        let actualCollateralToLiquidate = 0n;
        if (maxCollateralToLiquidate > collateralAmount) {
            actualCollateralToLiquidate = collateralAmount;
            actualLiquidationAmount =
                (((collateralReserveData.reserveData.price * actualCollateralToLiquidate * debtUint) /
                    (debtReserveData.reserveData.price * collateralUint)) *
                    PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        } else {
            actualCollateralToLiquidate = maxCollateralToLiquidate;
            actualLiquidationAmount = actualLiquidationAmount;
        }
        const expectedCollateralAfter =
            borrowerHealthInfo.totalSupplyInBaseCurrency -
            (actualCollateralToLiquidate * collateralReserveData.reserveData.price) / collateralUint;
        const expectedDebtAfter =
            borrowerHealthInfo.totalDebtInBaseCurrency -
            (actualLiquidationAmount * debtReserveData.reserveData.price) / debtUint;

        let bonusCollateral =
            actualCollateralToLiquidate -
            (actualCollateralToLiquidate * PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        let liquidationProtocolFee =
            (bonusCollateral * collateralReserveData.reserveConfiguration.liquidationProtocolFee) / PERCENTAGE_FACTOR;
        result = await liquidatorDebtReserveWallet.send(
            liquidator.getSender(),
            {
                value: toNano('10'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                amount: debtAmount,
                destination: pool.address,
                response_destination: liquidatorDebtReserveWallet.address,
                custom_payload: null,
                forward_ton_amount: toNano('4.1'),
                forward_payload: forward_payload,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: liquidatorDebtReserveWallet.address,
            to: poolDebtReserveWallet.address,
            success: true,
        });
        // TokenNotification
        expect(result.transactions).toHaveTransaction({
            from: poolDebtReserveWallet.address,
            to: pool.address,
            success: true,
        });
        // GetUserAccountData
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // UserAccountDataResponse
        expect(result.transactions).toHaveTransaction({
            from: borrowerAccount.address,
            to: pool.address,
            success: true,
        });
        // UpdatePosition debt token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn dToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerDTokenWallet.address,
            success: true,
        });
        // UpdatePosition collateral token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerATokenWallet.address,
            success: true,
        });

        accountData = await borrowerAccount.getAccount();
        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        // check borrower positions
        expect(Number(expectedCollateralAfter)).toBeCloseTo(
            Number(borrowerHealthInfo.totalSupplyInBaseCurrency),
            -5,
        );
        expect(Number(expectedDebtAfter)).toBeCloseTo(Number(borrowerHealthInfo.totalDebtInBaseCurrency), -5);
        const dTokenBalance = (await borrowerDTokenWallet.getGetWalletData()).balance;
        const aTokenBalance = (await borrowerATokenWallet.getGetWalletData()).balance;
        expect(dTokenBalance).toEqual(accountData.positionsDetail.get(debtReserve.address)?.borrow);
        expect(aTokenBalance).toEqual(accountData.positionsDetail.get(collateralReserve.address)?.supply);
        // check treasury collateral balance
        const flattenedTransactions = result.transactions.map((v) => flattenTransaction(v));
        const treasuryTx = flattenedTransactions.find(
            (v) => v.from?.equals(pool.address) && v.to?.equals(collateralReserveData.reserveConfiguration.treasury),
        );
        expect(Number(treasuryTx?.value)).toBeCloseTo(Number(liquidationProtocolFee), -7);
        // check liquidator collateral balance
        const transferliquidatorCollateralTx = flattenedTransactions.find(
            (v) => v.from?.equals(pool.address) && v.to?.equals(liquidator.address),
        );
        expect(Number(transferliquidatorCollateralTx?.value)).toBeCloseTo(
            Number(actualCollateralToLiquidate - liquidationProtocolFee),
            -7,
        );
    });

    it('supply jetton2, borrow Ton, closeFactor: 100%', async () => {
        const { dTokenAddress } = await addReserve(pool, deployer, pool.address, pool.address);
        await setMockOraclePrice(pool.address, toNano(1));

        expect(await pool.getReservesLength()).toEqual(3n);

        const amount = toNano(10000);
        let result = await pool.send(
            secondUser.getSender(),
            {
                value: amount + toNano(1),
            },
            {
                $$type: 'SupplyTon',
                amount,
            },
        );

        // provide liquidity
        await supply(secondUser.getSender(), sampleJetton2, 10000n * 10n ** reserveConfiguration2.decimals);

        // borrower supply jetton1 and borrow jetton2
        const borrower = deployer;
        const collateralReserve = sampleJetton2;
        const debtReserve = pool;
        const collateralUint = 10n ** reserveConfiguration2.decimals;
        const debtUint = 10n ** 9n;
        const supplyAmount = 10000n * collateralUint;
        const borrowAmount = 5000n * debtUint;
        await supply(deployer.getSender(), collateralReserve, supplyAmount);
        await pool.send(
            deployer.getSender(),
            {
                value: supplyAmount + toNano('1'),
            },
            {
                $$type: 'BorrowTon',
                amount: borrowAmount,
            },
        );
        const borrowerAccount = blockchain.openContract(await UserAccount.fromInit(pool.address, borrower.address));

        let accountData = await borrowerAccount.getAccount();
        let borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        let collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        let debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(2n);
        
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.borrow).toEqual(0n);
        
        expect(accountData.positionsDetail.get(debtReserve.address)?.supply).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            5,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            4,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // change debt asset price to shortfall borrower
        await setMockOraclePrice(debtReserve.address, toNano('2'));

        accountData = await borrowerAccount.getAccount();
        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);
        collateralReserveData = await pool.getReserveDataAndConfiguration(collateralReserve.address);
        debtReserveData = await pool.getReserveDataAndConfiguration(debtReserve.address);
        expect(accountData.positionsLength).toEqual(2n);
        
        expect(accountData.positionsDetail.get(collateralReserve.address)?.supply).toEqual(supplyAmount);
        expect(accountData.positionsDetail.get(collateralReserve.address)?.borrow).toEqual(0n);
        
        expect(accountData.positionsDetail.get(debtReserve.address)?.supply).toEqual(0n);
        expect(accountData.positionsDetail.get(debtReserve.address)?.borrow).toEqual(borrowAmount);
        expect(Number(fromNano(borrowerHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
            Number(fromNano((supplyAmount * collateralReserveData.reserveData.price) / collateralUint)),
            2,
        );
        expect(Number(fromNano(borrowerHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
            Number(fromNano((borrowAmount * debtReserveData.reserveData.price) / debtUint)),
            2,
        );
        expect(Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY)).toBeCloseTo(
            Number(
                (supplyAmount *
                    collateralReserveData.reserveData.price *
                    RAY *
                    debtUint *
                    collateralReserveData.reserveConfiguration.liquidationThreshold) /
                    (borrowAmount * debtReserveData.reserveData.price * PERCENTAGE_FACTOR * collateralUint),
            ) / Number(RAY),
            7,
        );

        // send liquidation message
        const liquidator = secondUser;
        const poolCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(pool.address)),
        );
        const liquidatorCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await collateralReserve.getGetWalletAddress(liquidator.address)),
        );
        const liquidatorCollateralWalletBalanceBefore = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        const treasuryCollateralWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(
                await collateralReserve.getGetWalletAddress(collateralReserveData.reserveConfiguration.treasury),
            ),
        );
        const dToken = blockchain.openContract(DToken.fromAddress(dTokenAddress));
        const borrowerDTokenWallet = blockchain.openContract(
            DTokenDefaultWallet.fromAddress(await dToken.getGetWalletAddress(borrower.address)),
        );
        const borrowerATokenWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken2.getGetWalletAddress(borrower.address)),
        );

        const debtAmount =
            accountData.positionsDetail.get(debtReserve.address)?.borrow || (0n * debtReserveData.normalizedDebt) / RAY;
        const collateralAmount =
            accountData.positionsDetail.get(collateralReserve.address)?.supply ||
            (0n * collateralReserveData.normalizedIncome) / RAY;
        const closeFactor = Number(borrowerHealthInfo.healthFactorInRay) / Number(RAY) > 0.95 ? 5000n : 10000n;
        let actualLiquidationAmount = (debtAmount * closeFactor) / PERCENTAGE_FACTOR;

        const maxCollateralToLiquidate =
            (((debtReserveData.reserveData.price * actualLiquidationAmount * collateralUint) /
                (collateralReserveData.reserveData.price * debtUint)) *
                collateralReserveData.reserveConfiguration.liquidationBonus) /
            PERCENTAGE_FACTOR;
        let actualCollateralToLiquidate = 0n;
        if (maxCollateralToLiquidate > collateralAmount) {
            actualCollateralToLiquidate = collateralAmount;
            actualLiquidationAmount =
                (((collateralReserveData.reserveData.price * actualCollateralToLiquidate * debtUint) /
                    (debtReserveData.reserveData.price * collateralUint)) *
                    PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        } else {
            actualCollateralToLiquidate = maxCollateralToLiquidate;
            actualLiquidationAmount = actualLiquidationAmount;
        }
        const expectedCollateralAfter =
            borrowerHealthInfo.totalSupplyInBaseCurrency -
            (actualCollateralToLiquidate * collateralReserveData.reserveData.price) / collateralUint;
        const expectedDebtAfter =
            borrowerHealthInfo.totalDebtInBaseCurrency -
            (actualLiquidationAmount * debtReserveData.reserveData.price) / debtUint;

        let bonusCollateral =
            actualCollateralToLiquidate -
            (actualCollateralToLiquidate * PERCENTAGE_FACTOR) /
                collateralReserveData.reserveConfiguration.liquidationBonus;
        let liquidationProtocolFee =
            (bonusCollateral * collateralReserveData.reserveConfiguration.liquidationProtocolFee) / PERCENTAGE_FACTOR;

        result = await pool.send(
            liquidator.getSender(),
            {
                value: debtAmount + toNano(1),
            },
            {
                $$type: 'LiquidateTon',
                borrower: borrower.address,
                collateralReserve: collateralReserve.address,
                liquidationAmount: debtAmount,
            },
        );

        expect(result.transactions).toHaveTransaction({
            from: liquidator.address,
            to: pool.address,
            success: true,
        });
        // GetUserAccountData
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // UserAccountDataResponse
        expect(result.transactions).toHaveTransaction({
            from: borrowerAccount.address,
            to: pool.address,
            success: true,
        });
        // UpdatePosition debt token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn dToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerDTokenWallet.address,
            success: true,
        });
        // UpdatePosition collateral token
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerAccount.address,
            success: true,
        });
        // burn aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: borrowerATokenWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: liquidatorCollateralWallet.address,
            success: true,
        });
        // tokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: poolCollateralWallet.address,
            to: treasuryCollateralWallet.address,
            success: true,
        });

        accountData = await borrowerAccount.getAccount();
        borrowerHealthInfo = await pool.getUserAccountHealthInfo(accountData);

        // check borrower positions
        expect(Number(expectedCollateralAfter)).toBeCloseTo(
            Number(borrowerHealthInfo.totalSupplyInBaseCurrency),
            -5,
        );
        expect(Number(expectedDebtAfter)).toBeCloseTo(Number(borrowerHealthInfo.totalDebtInBaseCurrency), -5);
        const dTokenBalance = (await borrowerDTokenWallet.getGetWalletData()).balance;
        const aTokenBalance = (await borrowerATokenWallet.getGetWalletData()).balance;
        expect(dTokenBalance).toEqual(accountData.positionsDetail.get(debtReserve.address)?.borrow);
        expect(aTokenBalance).toEqual(accountData.positionsDetail.get(collateralReserve.address)?.supply);
        // check treasury collateral balance
        const treasuryCollateralWalletBalance = (await treasuryCollateralWallet.getGetWalletData()).balance;
        expect(treasuryCollateralWalletBalance).toEqual(liquidationProtocolFee);
        // check liquidator collateral balance
        const liquidatorCollateralWalletBalanceAfter = (await liquidatorCollateralWallet.getGetWalletData()).balance;
        expect(
            Number(liquidatorCollateralWalletBalanceBefore + actualCollateralToLiquidate - liquidationProtocolFee),
        ).toBeCloseTo(Number(liquidatorCollateralWalletBalanceAfter), -5);
    });
});

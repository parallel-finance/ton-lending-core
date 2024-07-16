import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, beginCell, Cell, contractAddress, toNano } from '@ton/core';
import { ATokenDTokenContents, Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { DTokenDefaultWallet } from '../build/DToken/tact_DTokenDefaultWallet';
import { AToken } from '../wrappers/AToken';
import { DToken } from '../wrappers/DToken';
import { PERCENTAGE_FACTOR, RAY } from '../helpers/constant';

describe('Pool', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let aToken: SandboxContract<AToken>;
    let dToken: SandboxContract<DToken>;
    let contents: ATokenDTokenContents;

    let rst;

    const reserveAddress = address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV');

    const reserveConfiguration: ReserveConfiguration = {
        $$type: 'ReserveConfiguration',
        poolWalletAddress: reserveAddress,
        aTokenAddress: reserveAddress,
        dTokenAddress: reserveAddress,
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

    const reserveInterestRateStrategy: ReserveInterestRateStrategy = {
        $$type: 'ReserveInterestRateStrategy',
        optimalUsageRatio: BigInt(0.9 * 10 ** 27),
        maxUsageRatio: BigInt(10 ** 27) - BigInt(0.9 * 10 ** 27),
        baseBorrowRate: 0n,
        slope1: BigInt(0.04 * 10 ** 27),
        slope2: BigInt(0.6 * 10 ** 27),
    };

    const supplyFromDeployer = async (amount: bigint) => {
        // transfer jetton to pool
        const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address);
        const deployerJettonDefaultWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(deployerWalletAddress),
        );
        const forward_payload: Cell = beginCell().storeUint(0x55b591ba, 32).endCell();

        const userAccountContract = blockchain.openContract(await UserAccount.fromInit(pool.address, deployer.address));

        const result = await deployerJettonDefaultWallet.send(
            deployer.getSender(),
            {
                value: toNano('3'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                amount: amount,
                destination: pool.address,
                response_destination: deployerWalletAddress,
                custom_payload: null,
                forward_ton_amount: toNano('2'),
                forward_payload: forward_payload,
            },
        );
        // check user account
        const accountData = await userAccountContract.getAccount();
        expect(accountData.positionsLength).toEqual(1n);
        expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.supply).toEqual(amount);
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.asCollateral).toBeTruthy();
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        pool = blockchain.openContract(await Pool.fromInit());

        deployer = await blockchain.treasury('deployer');
        secondUser = (await blockchain.createWallets(2))[1];

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

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            deploy: true,
            success: true,
        });

        // deploy test jetton
        const jettonParams = {
            name: 'SampleJetton',
            description: 'Sample Jetton for testing purposes',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'SAM',
        };
        let max_supply = toNano(1000000n);
        let content = buildOnchainMetadata(jettonParams);

        const aTokenJettonParams = {
            name: 'SampleJetton AToken',
            description: 'Sample Jetton aToken',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'aSAM',
        };
        let aTokenContent = buildOnchainMetadata(aTokenJettonParams);

        const dTokenJettonParams = {
            name: 'SampleJetton DToken',
            description: 'Sample Jetton dToken',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'dSAM',
        };
        let dTokenContent = buildOnchainMetadata(dTokenJettonParams);
        contents = {
            $$type: 'ATokenDTokenContents',
            aTokenContent,
            dTokenContent,
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

        // add reserve
        const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
        const result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'AddReserve',
                reserveAddress: sampleJetton.address,
                reserveConfiguration: {
                    ...reserveConfiguration,
                    poolWalletAddress,
                },
                contents,
                reserveInterestRateStrategy,
            },
        );

        rst = await pool.send(
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

        const calculateATokenAddress = await pool.getCalculateATokenAddress(
            contents.aTokenContent,
            sampleJetton.address,
        );

        const calculateDTokenAddress = await pool.getCalculateDTokenAddress(
            contents.dTokenContent,
            sampleJetton.address,
        );
        console.log('calculateDTokenAddress', calculateDTokenAddress.toString());

        aToken = blockchain.openContract(AToken.fromAddress(calculateATokenAddress));
        dToken = blockchain.openContract(DToken.fromAddress(calculateDTokenAddress));

        expect((await aToken.getOwner()).toString()).toEqual(pool.address.toString());
        expect((await aToken.getGetPoolData()).pool.toString()).toEqual(pool.address.toString());
        expect((await aToken.getGetPoolData()).asset.toString()).toEqual(sampleJetton.address.toString());

        expect((await dToken.getOwner()).toString()).toEqual(pool.address.toString());
        expect((await dToken.getGetPoolData()).pool.toString()).toEqual(pool.address.toString());
        expect((await dToken.getGetPoolData()).asset.toString()).toEqual(sampleJetton.address.toString());

        // mint test jetton to deployer
        await sampleJetton.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Mint',
                amount: 100000000000n,
                receiver: deployer.address,
            },
        );

        // supply
        const amount = toNano(100n);
        await supplyFromDeployer(amount);
    });

    describe('borrow', () => {
        it('should borrow successfully', async () => {
            const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'BorrowToken',
                    tokenAddress: sampleJetton.address,
                    amount: toNano(50n),
                },
            );

            // BorrowToken
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
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
                to: dToken.address,
                success: true,
            });

            const userAccountContract = blockchain.openContract(userAccountAddress);
            const accountData = await userAccountContract.getAccount();
            expect(accountData.positionsLength).toEqual(1n);
            expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
            expect(accountData.positionsDetail?.get(sampleJetton.address)!!.supply).toEqual(toNano(100n));
            expect(accountData.positionsDetail?.get(sampleJetton.address)!!.borrow).toEqual(toNano(50n));

            const deployerDTokenDefaultWalletAddress = await dToken.getGetWalletAddress(deployer.address);
            const deployerDTokenDefaultWallet = blockchain.openContract(
                DTokenDefaultWallet.fromAddress(deployerDTokenDefaultWalletAddress),
            );

            const walletData = await deployerDTokenDefaultWallet.getGetWalletData();
            expect(walletData.balance).toEqual(toNano(50n));
            expect(walletData.owner.toString()).toEqual(deployer.address.toString());
        });
        it('check hf successfully', async () => {
            const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
            const borrowAmount = toNano(60n);

            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'BorrowToken',
                    tokenAddress: sampleJetton.address,
                    amount: borrowAmount,
                },
            );

            // BorrowToken
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
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
                to: dToken.address,
                success: true,
            });

            const userAccountContract = blockchain.openContract(userAccountAddress);
            const accountData = await userAccountContract.getAccount();

            let userHealthInfo = await pool.getUserAccountHealthInfo(accountData);
            expect(userHealthInfo.avgLtv).toEqual(reserveConfiguration.ltv);
            expect(userHealthInfo.avgLiquidationThreshold).toEqual(reserveConfiguration.liquidationThreshold);
            expect(userHealthInfo.totalCollateralInBaseCurrency).toEqual(100n * toNano(1));
            expect(userHealthInfo.totalSupplyInBaseCurrency).toEqual(100n * toNano(1));
            expect(userHealthInfo.totalDebtInBaseCurrency).toEqual(60n * toNano(1));
            expect(userHealthInfo.healthFactorInRay).toEqual(
                (100n * toNano(1) * reserveConfiguration.liquidationThreshold * RAY) /
                    (PERCENTAGE_FACTOR * 60n * toNano(1)),
            );
        });

        it('should borrow failed', async () => {
            const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
            const borrowAmount = toNano(60n) + 1n;
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'BorrowToken',
                    tokenAddress: sampleJetton.address,
                    amount: borrowAmount,
                },
            );

            // BorrowToken
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
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
                success: false,
            });
        });
    });

    it('should bounce if the borrowed asset is not configured for borrowing', async () => {
        const result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'BorrowToken',
                tokenAddress: deployer.address,
                amount: toNano(50n),
            },
        );

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: false,
        });
    });
});

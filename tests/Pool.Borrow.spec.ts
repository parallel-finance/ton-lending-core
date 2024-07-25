import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { fromNano, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { DTokenDefaultWallet } from '../build/DToken/tact_DTokenDefaultWallet';
import { DToken } from '../wrappers/DToken';
import { PERCENTAGE_FACTOR, RAY } from '../helpers/constant';
import { sumTransactionsFee } from '../jest.setup';
import { addReserve, deployJetton, deployPool, mintJetton, reserveConfiguration, supplyJetton } from './utils';

describe('Pool', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let dToken: SandboxContract<DToken>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        pool = blockchain.openContract(await Pool.fromInit());
        deployer = await blockchain.treasury('deployer');
        const sender = deployer.getSender();

        await deployPool(pool, deployer);
        // deploy test jetton
        const jettonParams = {
            name: 'SampleJetton',
            description: 'Sample Jetton for testing purposes',
            decimals: '9',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'SAM',
        };
        sampleJetton = await deployJetton(blockchain, deployer, jettonParams);
        await mintJetton(sampleJetton, sender, deployer.address, toNano(100n));

        const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
        const { dTokenAddress } = await addReserve(pool, deployer, sampleJetton.address, poolWalletAddress);

        dToken = blockchain.openContract(DToken.fromAddress(dTokenAddress));

        // supply
        const amount = toNano(100n);
        const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address!!);
        const deployerJettonDefaultWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(deployerWalletAddress),
        );
        await supplyJetton(deployerJettonDefaultWallet, deployer, pool.address, amount);
    });

    describe('borrow jetton', () => {
        it('should borrow successfully', async () => {
            const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address);
            const deployerJettonDefaultWallet = blockchain.openContract(
                JettonDefaultWallet.fromAddress(deployerWalletAddress),
            );
            const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);

            const walletDataBefore = await deployerJettonDefaultWallet.getGetWalletData();
            const walletBalanceBefore = walletDataBefore.balance;
            expect(walletBalanceBefore).toEqual(toNano(0));
            const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.4'),
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

            // Pool send the TransferToken message to the jetton contract
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: poolWalletAddress,
                success: true,
            });

            // Pool wallet transfer borrowed jetton to user
            expect(result.transactions).toHaveTransaction({
                from: poolWalletAddress,
                to: deployerJettonDefaultWallet.address,
                success: true,
            });

            printTransactionFees(result.transactions);
            const totalTransactionFee = sumTransactionsFee(result.transactions);
            expect(totalTransactionFee).toBeLessThanOrEqual(0.105); // real: 0.101080645

            const userAccountContract = blockchain.openContract(userAccountAddress);
            const accountData = await userAccountContract.getAccount();
            expect(accountData.positionsLength).toEqual(1n);
            expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
            expect(Number(fromNano(accountData.positionsDetail?.get(sampleJetton.address)!!.supply))).toBeCloseTo(100);
            expect(Number(fromNano(accountData.positionsDetail?.get(sampleJetton.address)!!.borrow))).toBeCloseTo(50);

            const deployerDTokenDefaultWalletAddress = await dToken.getGetWalletAddress(deployer.address);
            const deployerDTokenDefaultWallet = blockchain.openContract(
                DTokenDefaultWallet.fromAddress(deployerDTokenDefaultWalletAddress),
            );

            const walletData = await deployerDTokenDefaultWallet.getGetWalletData();
            expect(walletData.balance).toEqual(toNano(50n));
            // expect(walletData.owner.toString()).toEqual(deployer.address.toString());

            const walletDataAfter = await deployerJettonDefaultWallet.getGetWalletData();
            const walletBalanceAfter = walletDataAfter.balance;
            expect(Number(fromNano(walletBalanceAfter))).toBeCloseTo(50);
        });
        it('check hf successfully', async () => {
            const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
            const borrowAmount = toNano(60n);

            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.3'),
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
            expect(Number(fromNano(userHealthInfo.totalCollateralInBaseCurrency))).toBeCloseTo(
                Number(fromNano(100n * toNano(1))),
                7,
            );
            expect(Number(fromNano(userHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
                Number(fromNano(100n * toNano(1))),
                7,
            );
            expect(Number(fromNano(userHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
                Number(fromNano(60n * toNano(1))),
                7,
            );
            expect(Number(fromNano((toNano(1) * userHealthInfo.healthFactorInRay) / RAY))).toBeCloseTo(
                (100 * Number(reserveConfiguration.liquidationThreshold)) / (Number(PERCENTAGE_FACTOR) * 60),
                5,
            );
        });

        it('should borrow failed', async () => {
            const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
            const borrowAmount = toNano(60n) + 1n;
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.3'),
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

    describe('borrow ton', () => {
        it('should handle ton borrow successfully', async () => {
            // Add TON as reserve
            await addReserve(pool, deployer, pool.address, pool.address);

            const supplyAmount = toNano(100);
            // Supply Ton first to add liquidity
            await pool.send(
                deployer.getSender(),
                {
                    value: toNano('100.25'),
                },
                {
                    $$type: 'SupplyTon',
                    amount: supplyAmount,
                },
            );
            // Borrow Ton
            const borrowAmount = toNano(50);
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('100.25'),
                },
                {
                    $$type: 'BorrowTon',
                    amount: borrowAmount,
                },
            );
            // Check user account data
            const userAccountContract = blockchain.openContract(
                await UserAccount.fromInit(pool.address, deployer.address),
            );

            const userAccountAddress = userAccountContract.address;
            // UpdatePosition
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: userAccountAddress,
                success: true,
            });

            // UserPositionUpdated
            expect(result.transactions).toHaveTransaction({
                from: userAccountAddress,
                to: pool.address,
                success: true,
            });

            // check user account
            const accountData = await userAccountContract.getAccount();
            expect(accountData.positionsLength).toEqual(2n);
            expect(accountData.positions?.get(1n)!!.equals(pool.address)).toBeTruthy();
            expect(Number(fromNano(accountData.positionsDetail?.get(pool.address)!!.supply))).toBeCloseTo(100, 3);
            expect(Number(fromNano(accountData.positionsDetail?.get(pool.address)!!.borrow))).toBeCloseTo(50, 3);
            expect(accountData.positionsDetail?.get(pool.address)!!.asCollateral).toBeTruthy();
        });
    })

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

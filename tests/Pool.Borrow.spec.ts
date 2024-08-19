import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Dictionary, fromNano, toNano } from '@ton/core';
import { Pool, storeBorrowToken, storeBorrowTon } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount, UserAccountData } from '../build/Pool/tact_UserAccount';
import { DTokenDefaultWallet } from '../build/Pool/tact_DTokenDefaultWallet';
import { PERCENTAGE_FACTOR, RAY } from '../helpers/constant';
import { sumTransactionsFee } from '../jest.setup';
import { addReserve, deployJetton, deployPool, mintJetton, reserveConfiguration, supplyJetton } from './utils';
import { DToken } from '../build/Pool/tact_DToken';
import { senderArgsToMessageRelaxed } from '../scripts/utils';

describe('Pool', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let dToken: SandboxContract<DToken>;

    jest.setTimeout(60 * 1000);

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        pool = blockchain.openContract(await Pool.fromInit());
        deployer = await blockchain.treasury('deployer');
        secondUser = await blockchain.treasury('secondUser');
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
        await mintJetton(sampleJetton, secondUser.getSender(), secondUser.address, toNano(10000n));

        const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
        const { dTokenAddress, aTokenDTokenContents } = await addReserve(
            pool,
            deployer,
            sampleJetton.address,
            poolWalletAddress,
        );
        expect(dTokenAddress).toEqualAddress(
            (await DToken.fromInit(pool.address, aTokenDTokenContents.dTokenContent, sampleJetton.address)).address,
        );

        dToken = blockchain.openContract(DToken.fromAddress(dTokenAddress));

        // supply
        const amount = toNano(100n);
        const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address!!);
        const secondUserWalletAddress = await sampleJetton.getGetWalletAddress(secondUser.address!!);
        const deployerJettonDefaultWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(deployerWalletAddress),
        );
        const secondUserJettonDefaultWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(secondUserWalletAddress),
        );
        await supplyJetton(deployerJettonDefaultWallet, deployer, pool.address, amount);
        await supplyJetton(secondUserJettonDefaultWallet, secondUser, pool.address, toNano(10000n));
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

            const totalTransactionFee = sumTransactionsFee(result.transactions);
            expect(totalTransactionFee).toBeLessThanOrEqual(0.11); // real: 0.10973918099999999

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
            expect(deployerDTokenDefaultWalletAddress).toEqualAddress(
                (
                    await DTokenDefaultWallet.fromInit(
                        dToken.address,
                        pool.address,
                        sampleJetton.address,
                        deployer.address,
                    )
                ).address,
            );
            expect(deployerDTokenDefaultWalletAddress).toEqualAddress(
                await pool.getUserDTokenWalletAddress(sampleJetton.address, deployer.address),
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
            expect(Number(fromNano(userHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
                Number(fromNano(100n * toNano(1))),
                6,
            );
            expect(Number(fromNano(userHealthInfo.totalSupplyInBaseCurrency))).toBeCloseTo(
                Number(fromNano(100n * toNano(1))),
                6,
            );
            expect(Number(fromNano(userHealthInfo.totalDebtInBaseCurrency))).toBeCloseTo(
                Number(fromNano(60n * toNano(1))),
                6,
            );
            expect(Number(fromNano((toNano(1) * userHealthInfo.healthFactorInRay) / RAY))).toBeCloseTo(
                (100 * Number(reserveConfiguration.liquidationThreshold)) / (Number(PERCENTAGE_FACTOR) * 60),
                5,
            );

            const userAccountsData: Dictionary<Address, UserAccountData> = Dictionary.empty(Dictionary.Keys.Address());
            userAccountsData.set(deployer.address, accountData);
            // userAccountsData.set(pool.address, accountData)
            // console.log(await pool.getBatchUserAccountHealthInfo(userAccountsData))
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

        it('Reentrancy borrow should be failed', async () => {
            const borrowMessage = senderArgsToMessageRelaxed({
                to: pool.address,
                value: toNano('0.4'),
                body: beginCell()
                    .store(
                        storeBorrowToken({
                            $$type: 'BorrowToken',
                            tokenAddress: sampleJetton.address,
                            amount: toNano(60n),
                        }),
                    )
                    .endCell(),
            });
            const result = await deployer.sendMessages([borrowMessage, borrowMessage]);
            // the second borrow transaction will be failed
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: false,
                exitCode: 53463,
            });
            // printTransactionFees(result.transactions);
            const userAccount = blockchain.openContract(await UserAccount.fromInit(pool.address, deployer.address));
            const accountData = await userAccount.getAccount();
            const userHealthInfo = await pool.getUserAccountHealthInfo(accountData);
            expect(accountData.positionsDetail.get(sampleJetton.address)?.borrow).toEqual(toNano(60n));
            expect(userHealthInfo.totalDebtInBaseCurrency).toEqual(toNano(60n));
            expect(userHealthInfo.healthFactorInRay).toBeGreaterThan(RAY);
            expect(await pool.getUserLock(deployer.address)).toEqual(false);
        });

        it('should release lock successfully when failed to validationForAction', async () => {
            const borrowMessage = senderArgsToMessageRelaxed({
                to: pool.address,
                value: toNano('0.4'),
                body: beginCell()
                    .store(
                        storeBorrowToken({
                            $$type: 'BorrowToken',
                            tokenAddress: sampleJetton.address,
                            amount: toNano(600n), // collateral can't cover new borrow
                        }),
                    )
                    .endCell(),
            });
            const result = await deployer.sendMessages([borrowMessage]);
            const userAccount = blockchain.openContract(await UserAccount.fromInit(pool.address, deployer.address));
            // collateral can't cover new borrow
            expect(result.transactions).toHaveTransaction({
                from: userAccount.address,
                to: pool.address,
                success: false,
                exitCode: 48281,
            });
            // cashback
            expect(result.transactions).toHaveTransaction({
                from: userAccount.address,
                to: deployer.address,
                success: true,
                op: 0,
            });

            // printTransactionFees(result.transactions);
            const accountData = await userAccount.getAccount();
            const userHealthInfo = await pool.getUserAccountHealthInfo(accountData);
            expect(accountData.positionsDetail.get(sampleJetton.address)?.borrow).toEqual(toNano(0));
            expect(userHealthInfo.totalDebtInBaseCurrency).toEqual(toNano(0));
            expect(userHealthInfo.healthFactorInRay).toBeGreaterThan(RAY);
            // should release lock successfully.
            expect(await pool.getUserLock(deployer.address)).toEqual(false);
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
                    value: toNano('0.4'),
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
        });

        it('Reentrancy borrow ton should be failed', async () => {
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
            await pool.send(
                secondUser.getSender(),
                {
                    value: toNano('100.25'),
                },
                {
                    $$type: 'SupplyTon',
                    amount: supplyAmount,
                },
            );
            const borrowMessage = senderArgsToMessageRelaxed({
                to: pool.address,
                value: toNano('0.4'),
                body: beginCell()
                    .store(
                        storeBorrowTon({
                            $$type: 'BorrowTon',
                            amount: toNano(50),
                        }),
                    )
                    .endCell(),
            });
            const result = await deployer.sendMessages([borrowMessage, borrowMessage]);
            // the second borrow transaction will be failed
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: false,
                exitCode: 53463,
            });
            // printTransactionFees(result.transactions);
            const userAccount = blockchain.openContract(await UserAccount.fromInit(pool.address, deployer.address));
            const accountData = await userAccount.getAccount();
            const userHealthInfo = await pool.getUserAccountHealthInfo(accountData);
            expect(accountData.positionsDetail.get(pool.address)?.borrow).toEqual(toNano(50n));
            expect(userHealthInfo.totalDebtInBaseCurrency).toEqual(toNano(50n));
            expect(userHealthInfo.healthFactorInRay).toBeGreaterThan(RAY);
            expect(await pool.getUserLock(deployer.address)).toEqual(false);
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

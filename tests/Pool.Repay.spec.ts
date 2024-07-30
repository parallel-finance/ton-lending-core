import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, fromNano, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { DTokenDefaultWallet } from '../build/Pool/tact_DTokenDefaultWallet';
import { sumTransactionsFee } from '../jest.setup';
import { addReserve, deployJetton, deployPool, mintJetton, supplyJetton } from './utils';
import { sleep } from '@ton/blueprint';
import { DToken } from '../build/Pool/tact_DToken';

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

    describe('Repay', () => {
        it('should repay jetton successfully', async () => {
            const userWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address);
            const userJettonDefaultWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(userWalletAddress));
            const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);

            const walletDataBefore = await userJettonDefaultWallet.getGetWalletData();
            const walletBalanceBefore = walletDataBefore.balance;
            expect(walletBalanceBefore).toEqual(toNano(0));
            await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.3'),
                },
                {
                    $$type: 'BorrowToken',
                    tokenAddress: sampleJetton.address,
                    amount: toNano(50n),
                },
            );

            const userDTokenDefaultWalletAddress = await dToken.getGetWalletAddress(deployer.address);
            const userDTokenDefaultWallet = blockchain.openContract(
                DTokenDefaultWallet.fromAddress(userDTokenDefaultWalletAddress),
            );

            const walletData = await userDTokenDefaultWallet.getGetWalletData();
            expect(Number(fromNano(walletData.balance))).toBeCloseTo(50, 5);
            expect(walletData.owner.toString()).toEqual(deployer.address.toString());

            const forward_payload: Cell = beginCell().storeUint(0x9c797a9, 32).endCell();

            await sleep(1000);

            const result = await userJettonDefaultWallet.send(
                deployer.getSender(),
                {
                    value: toNano('0.3'),
                },
                {
                    $$type: 'TokenTransfer',
                    queryId: 1n,
                    amount: toNano(25),
                    destination: pool.address,
                    response_destination: deployer.getSender().address!!,
                    custom_payload: null,
                    forward_ton_amount: toNano('0.25'),
                    forward_payload: forward_payload,
                },
            );

            // Token transfer
            expect(result.transactions).toHaveTransaction({
                from: userJettonDefaultWallet.address,
                to: poolWalletAddress,
                success: true,
            });

            // Token Notification
            expect(result.transactions).toHaveTransaction({
                from: poolWalletAddress,
                to: pool.address,
                success: true,
            });

            const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
            const userAccountContract = blockchain.openContract(userAccountAddress);

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
            // Update UserAccountData
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: userAccountAddress.address,
                success: true,
            });

            // UserPositionUpdated
            expect(result.transactions).toHaveTransaction({
                from: userAccountAddress.address,
                to: pool.address,
                success: true,
            });

            // Burn dToken
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: userDTokenDefaultWallet.address,
                success: true,
            });

            const walletDataAfter = await userDTokenDefaultWallet.getGetWalletData();
            expect(Number(fromNano(walletDataAfter.balance))).toBeCloseTo(Number(fromNano(toNano(25n))), 5);
            expect(walletDataAfter.owner.toString()).toEqual(deployer.address.toString());

            const accountData = await userAccountContract.getAccount();
            expect(accountData.positionsLength).toEqual(1n);
            expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
            expect(Number(fromNano(accountData.positionsDetail?.get(sampleJetton.address)!!.supply))).toBeCloseTo(
                100,
                5,
            );
            expect(Number(fromNano(accountData.positionsDetail?.get(sampleJetton.address)!!.borrow))).toBeCloseTo(
                25,
                5,
            );

            const totalTransactionFee = sumTransactionsFee(result.transactions);
            expect(totalTransactionFee).toBeLessThanOrEqual(0.11);
        });

        it('should repay max ton successfully', async () => {
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
            await pool.send(
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

            // check user account
            let accountData = await userAccountContract.getAccount();
            expect(accountData.positionsLength).toEqual(2n);
            expect(accountData.positions?.get(1n)!!.equals(pool.address)).toBeTruthy();
            expect(Number(fromNano(accountData.positionsDetail?.get(pool.address)!!.supply))).toBeCloseTo(100, 3);
            expect(Number(fromNano(accountData.positionsDetail?.get(pool.address)!!.borrow))).toBeCloseTo(50, 3);

            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.4'),
                },
                {
                    $$type: 'RepayTon',
                    amount: borrowAmount,
                },
            );

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

            accountData = await userAccountContract.getAccount();
            expect(accountData.positionsLength).toEqual(2n);
            expect(accountData.positions?.get(1n)!!.equals(pool.address)).toBeTruthy();
            expect(Number(fromNano(accountData.positionsDetail?.get(pool.address)!!.supply))).toBeCloseTo(100, 3);
            expect(Number(fromNano(accountData.positionsDetail?.get(pool.address)!!.borrow))).toBeCloseTo(0, 3);
        });
    });
});

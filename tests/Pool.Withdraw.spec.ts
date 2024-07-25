import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { fromNano, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { AToken } from '../wrappers/AToken';
import { DToken } from '../wrappers/DToken';
import { PERCENTAGE_FACTOR } from '../helpers/constant';
import { ATokenDefaultWallet } from '../build/AToken/tact_ATokenDefaultWallet';
import { sleep } from '@ton/blueprint';
import { sumTransactionsFee } from '../jest.setup';
import { addReserve, deployJetton, deployPool, mintJetton, reserveConfiguration, supplyJetton } from './utils';

describe('Pool Withdraw', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let aToken: SandboxContract<AToken>;
    let dToken: SandboxContract<DToken>;
    let deployerJettonDefaultWallet: SandboxContract<JettonDefaultWallet>;
    let deployerATokenDefaultWallet: SandboxContract<ATokenDefaultWallet>;
    let poolWallet: SandboxContract<JettonDefaultWallet>;

    const supplyAmount = toNano(100n);

    const borrowFromDeployer = async (amount: bigint) => {
        const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);

        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.3'),
            },
            {
                $$type: 'BorrowToken',
                tokenAddress: sampleJetton.address,
                amount: amount,
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
    };

    jest.setTimeout(20 * 1000);

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
        const { aTokenAddress, dTokenAddress } = await addReserve(
            pool,
            deployer,
            sampleJetton.address,
            poolWalletAddress,
        );

        aToken = blockchain.openContract(await AToken.fromAddress(aTokenAddress));
        dToken = blockchain.openContract(DToken.fromAddress(dTokenAddress));

        const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address!!);
        deployerJettonDefaultWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(deployerWalletAddress));

        deployerATokenDefaultWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken.getGetWalletAddress(deployer.address)),
        );

        // supply
        await supplyJetton(deployerJettonDefaultWallet, deployer, pool.address, supplyAmount);
        poolWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(poolWalletAddress));
    });

    it('withdraw successfully with no debt', async () => {
        const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
        const withdrawAmount = toNano(50n);
        const deployerJettonBalanceBefore = (await deployerJettonDefaultWallet.getGetWalletData()).balance;

        const result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.25'),
            },
            {
                $$type: 'WithdrawToken',
                tokenAddress: sampleJetton.address,
                amount: withdrawAmount,
            },
        );

        // WithdrawToken
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

        // sendTokenTransferByPool TokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: poolWallet.address,
            success: true,
        });

        // UpdatePosition
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

        // Burn aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: deployerATokenDefaultWallet.address,
            success: true,
        });

        // aToken-wallet to aToken-master TokenBurnNotification
        expect(result.transactions).toHaveTransaction({
            from: deployerATokenDefaultWallet.address,
            to: aToken.address,
            success: true,
        });

        const userAccountContract = blockchain.openContract(userAccountAddress);
        const accountData = await userAccountContract.getAccount();
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.supply).toEqual(supplyAmount - withdrawAmount);
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.borrow).toEqual(toNano(0n));

        const walletData = await deployerATokenDefaultWallet.getGetWalletData();
        expect(walletData.balance).toEqual(supplyAmount - withdrawAmount);
        expect((await deployerJettonDefaultWallet.getGetWalletData()).balance).toEqual(
            deployerJettonBalanceBefore + withdrawAmount,
        );
    });

    it('withdraw max amount successfully with no debt', async () => {
        const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
        const withdrawAmount = supplyAmount;
        const deployerJettonBalanceBefore = (await deployerJettonDefaultWallet.getGetWalletData()).balance;
        const result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.5'),
            },
            {
                $$type: 'WithdrawToken',
                tokenAddress: sampleJetton.address,
                amount: withdrawAmount,
            },
        );

        // WithdrawToken
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

        // sendTokenTransferByPool TokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: poolWallet.address,
            success: true,
        });

        // UpdatePosition
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

        // Burn aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: deployerATokenDefaultWallet.address,
            success: true,
        });

        // aToken-wallet to aToken-master TokenBurnNotification
        expect(result.transactions).toHaveTransaction({
            from: deployerATokenDefaultWallet.address,
            to: aToken.address,
            success: true,
        });

        const userAccountContract = blockchain.openContract(userAccountAddress);
        const accountData = await userAccountContract.getAccount();
        expect(accountData.positionsLength).toEqual(1n);
        expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.supply).toEqual(supplyAmount - withdrawAmount);
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.borrow).toEqual(toNano(0n));

        const walletData = await deployerATokenDefaultWallet.getGetWalletData();
        expect(walletData.balance).toEqual(supplyAmount - withdrawAmount);
        expect((await deployerJettonDefaultWallet.getGetWalletData()).balance).toEqual(
            deployerJettonBalanceBefore + withdrawAmount,
        );

        const totalTransactionFee = sumTransactionsFee(result.transactions);
        expect(totalTransactionFee).toBeLessThanOrEqual(0.1);
    });

    it('withdraw max amount when user have the debt and check HF successfully', async () => {
        const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
        const userAccountContract = blockchain.openContract(userAccountAddress);

        const borrowAmount = toNano(60n);
        await borrowFromDeployer(borrowAmount / 2n);
        await sleep(5 * 1000);
        await borrowFromDeployer(borrowAmount / 2n);

        const maxWithdrawAmount =
            supplyAmount - (borrowAmount * PERCENTAGE_FACTOR) / reserveConfiguration.liquidationThreshold;
        // withdraw
        const withdrawAmount = maxWithdrawAmount - toNano('0.01');
        const deployerJettonBalanceBefore = (await deployerJettonDefaultWallet.getGetWalletData()).balance;
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.25'),
            },
            {
                $$type: 'WithdrawToken',
                tokenAddress: sampleJetton.address,
                amount: withdrawAmount,
            },
        );

        // WithdrawToken
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

        // sendTokenTransferByPool TokenTransfer
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: poolWallet.address,
            success: true,
        });

        // UpdatePosition
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

        // Burn aToken
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: deployerATokenDefaultWallet.address,
            success: true,
        });

        // aToken-wallet to aToken-master TokenBurnNotification
        expect(result.transactions).toHaveTransaction({
            from: deployerATokenDefaultWallet.address,
            to: aToken.address,
            success: true,
        });

        let accountData = await userAccountContract.getAccount();

        expect(Number(fromNano(accountData.positionsDetail?.get(sampleJetton.address)!!.supply))).toBeCloseTo(
            Number(fromNano(supplyAmount - withdrawAmount)),
            5,
        );
        expect(Number(fromNano(accountData.positionsDetail?.get(sampleJetton.address)!!.borrow))).toBeCloseTo(
            Number(fromNano(borrowAmount)),
            5,
        );

        const walletData = await deployerATokenDefaultWallet.getGetWalletData();
        expect(Number(fromNano(walletData.balance))).toBeCloseTo(Number(fromNano(supplyAmount - withdrawAmount)), 5);
        expect((await deployerJettonDefaultWallet.getGetWalletData()).balance).toEqual(
            deployerJettonBalanceBefore + withdrawAmount,
        );

        const totalTransactionFee = sumTransactionsFee(result.transactions);
        expect(totalTransactionFee).toBeLessThanOrEqual(0.11);
    });

    it('should bounce if the left supply position cant cover the debt', async () => {
        const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);

        const borrowAmount = toNano(60n);
        await borrowFromDeployer(borrowAmount);

        const maxWithdrawAmount =
            supplyAmount - (borrowAmount * PERCENTAGE_FACTOR) / reserveConfiguration.liquidationThreshold;
        // withdraw
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.25'),
            },
            {
                $$type: 'WithdrawToken',
                tokenAddress: sampleJetton.address,
                amount: maxWithdrawAmount + 2n,
            },
        );

        // WithdrawToken
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

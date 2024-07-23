import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, beginCell, Cell, fromNano, toNano } from '@ton/core';
import { ATokenDTokenContents, Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { DTokenDefaultWallet } from '../build/DToken/tact_DTokenDefaultWallet';
import { AToken } from '../wrappers/AToken';
import { DToken } from '../wrappers/DToken';
import { PERCENTAGE_FACTOR } from '../helpers/constant';
import { ATokenDefaultWallet } from '../build/AToken/tact_ATokenDefaultWallet';
import { sleep } from '@ton/blueprint';

describe('Pool Withdraw', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let aToken: SandboxContract<AToken>;
    let dToken: SandboxContract<DToken>;
    let contents: ATokenDTokenContents;
    let deployerJettonDefaultWallet: SandboxContract<JettonDefaultWallet>;
    let deployerATokenDefaultWallet: SandboxContract<ATokenDefaultWallet>;
    let deployerDTokenDefaultWallet: SandboxContract<DTokenDefaultWallet>;
    let poolWallet: SandboxContract<JettonDefaultWallet>;

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

    const supplyAmount = toNano(100n);

    const supplyFromDeployer = async (amount: bigint) => {
        // transfer jetton to pool
        const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address);
        deployerJettonDefaultWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(deployerWalletAddress));
        const forward_payload: Cell = beginCell().storeUint(0x55b591ba, 32).endCell();

        const userAccountContract = blockchain.openContract(await UserAccount.fromInit(pool.address, deployer.address));

        await deployerJettonDefaultWallet.send(
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

    const borrowFromDeployer = async (amount: bigint) => {
        const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
        const borrowAmount = amount;

        let result = await pool.send(
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
    };

    jest.setTimeout(20 * 1000);

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
            decimals: '9',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'SAM',
        };
        let max_supply = toNano(1000000n);
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
        poolWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(poolWalletAddress));
        await pool.send(
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
        deployerATokenDefaultWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken.getGetWalletAddress(deployer.address)),
        );
        deployerDTokenDefaultWallet = blockchain.openContract(
            DTokenDefaultWallet.fromAddress(await dToken.getGetWalletAddress(deployer.address)),
        );

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
                queryId: 0n,
                amount: 100000000000n,
                receiver: deployer.address,
            },
        );

        // supply
        await supplyFromDeployer(supplyAmount);
    });

    it('withdraw successfully with no debt', async () => {
        const userAccountAddress = await UserAccount.fromInit(pool.address, deployer.address);
        const withdrawAmount = toNano(50n);
        const deployerJettonBalanceBefore = (await deployerJettonDefaultWallet.getGetWalletData()).balance;

        const result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('1.5'),
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
                value: toNano('1.5'),
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
                value: toNano('1.5'),
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

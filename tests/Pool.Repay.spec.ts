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
import { sumTransactionsFee } from '../jest.setup';

describe('Pool', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let aToken: SandboxContract<AToken>;
    let dToken: SandboxContract<DToken>;
    let contents: ATokenDTokenContents;

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
    const RAY = 10n ** 27n;

    const reserveInterestRateStrategy: ReserveInterestRateStrategy = {
        $$type: 'ReserveInterestRateStrategy',
        optimalUsageRatio: (RAY * 9n) / 10n,
        maxUsageRatio: RAY / 10n,
        baseBorrowRate: 0n,
        slope1: (RAY * 4n) / 100n,
        slope2: (RAY * 6n) / 10n,
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

        const calculateATokenAddress = await pool.getCalculateATokenAddress(
            contents.aTokenContent,
            sampleJetton.address,
        );

        const calculateDTokenAddress = await pool.getCalculateDTokenAddress(
            contents.dTokenContent,
            sampleJetton.address,
        );
        reserveConfiguration.aTokenAddress = calculateATokenAddress;
        reserveConfiguration.dTokenAddress = calculateDTokenAddress;

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

        await pool.send(
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
                queryId: 0n,
                token: sampleJetton.address,
                amount: toNano(100n),
                receiver: deployer.address,
            },
        );

        // supply
        const amount = toNano(100n);
        await supplyFromDeployer(amount);
    });

    describe('Repay', () => {
        it('should repay successfully', async () => {
            const userWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address);
            const userJettonDefaultWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(userWalletAddress));
            const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);

            const walletDataBefore = await userJettonDefaultWallet.getGetWalletData();
            const walletBalanceBefore = walletDataBefore.balance;
            expect(walletBalanceBefore).toEqual(toNano(0));
            await pool.send(
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

            const userDTokenDefaultWalletAddress = await dToken.getGetWalletAddress(deployer.address);
            const userDTokenDefaultWallet = blockchain.openContract(
                DTokenDefaultWallet.fromAddress(userDTokenDefaultWalletAddress),
            );

            const walletData = await userDTokenDefaultWallet.getGetWalletData();
            expect(Number(fromNano(walletData.balance))).toBeCloseTo(50, 5);
            expect(walletData.owner.toString()).toEqual(deployer.address.toString());

            const forward_payload: Cell = beginCell().storeUint(0x9c797a9, 32).endCell();

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
            expect(totalTransactionFee).toBeLessThanOrEqual(0.1);
        });
    });
});

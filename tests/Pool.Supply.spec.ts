import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, beginCell, Cell, toNano } from '@ton/core';
import {
    ATokenDTokenContents,
    Pool,
    ReserveConfiguration,
    ReserveInterestRateStrategy,
    UpdatePosition,
} from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { ATokenDefaultWallet } from '../build/AToken/tact_ATokenDefaultWallet';
import { AToken } from '../wrappers/AToken';
import { sumTransactionsFee } from '../jest.setup';
import { RERUN_ACTION_MINT, RERUN_ACTION_UPDATE_POSITION } from '../helpers/constant';
import { parsePoolBounceMessage } from '../helpers/pool';

describe('Pool Supply', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let aToken: SandboxContract<AToken>;

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
        const contents: ATokenDTokenContents = {
            $$type: 'ATokenDTokenContents',
            aTokenContent,
            dTokenContent: Cell.EMPTY, // TODO
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

        const calculateATokenAddress = await pool.getCalculateATokenAddress(
            contents.aTokenContent,
            sampleJetton.address,
        );

        aToken = blockchain.openContract(AToken.fromAddress(calculateATokenAddress));
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
                token: sampleJetton.address,
                amount: 100000000000n,
                receiver: deployer.address,
            },
        );
    });

    const supplyJetton = async (amount: bigint) => {
        // transfer jetton to pool
        const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address);
        const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
        const deployerJettonDefaultWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(deployerWalletAddress),
        );
        const forward_payload: Cell = beginCell().storeUint(0x55b591ba, 32).endCell();

        const userAccountContract = blockchain.openContract(await UserAccount.fromInit(pool.address, deployer.address));
        const userAccountAddress = userAccountContract.address;

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

        // TokenTransferInternal
        expect(result.transactions).toHaveTransaction({
            from: deployerWalletAddress,
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

        // open this line to see the details
        // printTransactionFees(result.transactions);
        const totalTransactionFee = sumTransactionsFee(result.transactions);
        expect(totalTransactionFee).toBeLessThanOrEqual(0.1);

        // check user account
        const accountData = await userAccountContract.getAccount();
        expect(accountData.positionsLength).toEqual(1n);
        expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.supply).toEqual(amount);
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.asCollateral).toBeTruthy();
    };

    describe('handle supply', () => {
        it('should handle supply successfully', async () => {
            const amount = toNano(100n);
            await supplyJetton(amount);
        });

        it('transfer AToken', async () => {
            const amount = toNano(100n);
            await supplyJetton(amount);
            const aTokenWallet = blockchain.openContract(
                ATokenDefaultWallet.fromAddress(
                    await pool.getUserATokenWalletAddress(sampleJetton.address, deployer.getSender().address),
                ),
            );
            const walletData = await aTokenWallet.getGetWalletData();
            expect(walletData.balance).toEqual(amount);
            expect(walletData.owner.toString()).toEqual(deployer.address.toString());

            const secondUserWallet = blockchain.openContract(
                ATokenDefaultWallet.fromAddress(await aToken.getGetWalletAddress(secondUser.address)),
            );

            const result = await aTokenWallet.send(
                deployer.getSender(),
                {
                    value: toNano('1.5'),
                },
                {
                    $$type: 'TokenTransfer',
                    queryId: 1n,
                    amount: toNano(100),
                    destination: secondUser.address,
                    response_destination: deployer.getSender().address!!,
                    custom_payload: null,
                    forward_ton_amount: toNano('1'),
                    forward_payload: Cell.EMPTY,
                },
            );
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: aTokenWallet.address,
                success: true,
            });
            expect(result.transactions).toHaveTransaction({
                from: aTokenWallet.address,
                to: pool.address,
                success: true,
            });
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: aTokenWallet.address,
                success: true,
            });
            expect(result.transactions).toHaveTransaction({
                from: aTokenWallet.address,
                to: secondUserWallet.address,
                success: true,
            });
            const secondUserWalletData = await secondUserWallet.getGetWalletData();
            expect(secondUserWalletData.balance).toEqual(toNano('100'));
            expect(secondUserWalletData.master.toString()).toEqual(aToken.address.toString());
        });

        it('check reservesData after supply', async () => {
            const amount = toNano(100n);
            await supplyJetton(amount);
            const reserveData = await pool.getReserveData(sampleJetton.address);
            expect(reserveData.availableLiquidity).toEqual(amount);
            expect(reserveData.totalSupply).toEqual(amount);
            expect(reserveData.liquidityIndex).toEqual(BigInt('1000000000000000000000000000'));
            expect(reserveData.borrowIndex).toEqual(BigInt('1000000000000000000000000000'));
        });

        it('should fail if the jetton is not configured', async () => {
            await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 0n,
                },
            );
            const reserveLength = await pool.getReservesLength();
            expect(reserveLength).toEqual(0n);

            const amount = toNano(100n);

            // transfer jetton to pool
            const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address);
            const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
            const deployerJettonDefaultWallet = blockchain.openContract(
                JettonDefaultWallet.fromAddress(deployerWalletAddress),
            );
            const forward_payload: Cell = beginCell().storeUint(0x55b591ba, 32).endCell();

            const result = await deployerJettonDefaultWallet.send(
                deployer.getSender(),
                {
                    value: toNano('0.1'),
                },
                {
                    $$type: 'TokenTransfer',
                    queryId: 0n,
                    amount: amount,
                    destination: pool.address,
                    response_destination: deployerWalletAddress,
                    custom_payload: null,
                    forward_ton_amount: toNano('0.05'),
                    forward_payload: forward_payload,
                },
            );

            // TransferNotification -> failed to pass the check
            expect(result.transactions).toHaveTransaction({
                from: poolWalletAddress,
                to: pool.address,
                success: false,
            });
        });

        it('UpdatePosition and MintAToken Bounce and rerun', async () => {
            // transfer jetton to pool
            const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address);
            const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
            const deployerJettonDefaultWallet = blockchain.openContract(
                JettonDefaultWallet.fromAddress(deployerWalletAddress),
            );
            const forward_payload: Cell = beginCell().storeUint(0x55b591ba, 32).endCell();

            const userAccountContract = blockchain.openContract(
                await UserAccount.fromInit(pool.address, deployer.address),
            );
            const userAccountAddress = userAccountContract.address;
            const amount = toNano(100n);

            let result = await deployerJettonDefaultWallet.send(
                deployer.getSender(),
                {
                    value: toNano('0.5'),
                },
                {
                    $$type: 'TokenTransfer',
                    queryId: 0n,
                    amount: amount,
                    destination: pool.address,
                    response_destination: deployerWalletAddress,
                    custom_payload: null,
                    forward_ton_amount: toNano('0.025'),
                    forward_payload: forward_payload,
                },
            );

            // TokenTransferInternal
            expect(result.transactions).toHaveTransaction({
                from: deployerWalletAddress,
                to: poolWalletAddress,
                success: true,
            });

            // TransferNotification
            expect(result.transactions).toHaveTransaction({
                from: poolWalletAddress,
                to: pool.address,
                success: true,
            });

            // UpdatePosition should be failed
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: userAccountAddress,
                success: false,
            });
            // check user account
            let accountData = await userAccountContract.getAccount();
            expect(accountData.positionsLength).toEqual(0n);

            let msgId = (await pool.getQueryId()) - 1n;
            const updatePositionMsg = parsePoolBounceMessage(await pool.getBounceMsg(msgId)) as UpdatePosition;
            expect(updatePositionMsg?.$$type).toEqual('UpdatePosition');
            expect(updatePositionMsg?.queryId).toEqual(msgId);
            expect(updatePositionMsg?.user.toString()).toEqual(deployer.getSender().address.toString());
            expect(updatePositionMsg?.address.toString()).toEqual(sampleJetton.address.toString());
            expect(updatePositionMsg?.supply).toEqual(100000000000n);
            expect(updatePositionMsg?.borrow).toEqual(0n);

            result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'RerunBounceMsg',
                    queryId: msgId,
                    action: RERUN_ACTION_UPDATE_POSITION,
                },
            );

            // RerunBounceMsg
            expect(result.transactions).toHaveTransaction({
                from: deployer.getSender().address,
                to: pool.address,
                success: true,
            });
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
            // mintAToken bounce because of the gas
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: aToken.address,
                success: false,
            });
            expect(await pool.getBounceMsg(msgId)).toEqual(null);
            // rerun mint msg
            const aTokenWallet = blockchain.openContract(
                ATokenDefaultWallet.fromAddress(
                    await pool.getUserATokenWalletAddress(sampleJetton.address, deployer.getSender().address),
                ),
            );
            msgId = (await pool.getQueryId()) - 1n;
            result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.08'),
                },
                {
                    $$type: 'RerunBounceMsg',
                    queryId: msgId,
                    action: RERUN_ACTION_MINT,
                },
            );
            // mintAToken
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: aToken.address,
                success: true,
            });
            // aToken TokenTransferInternal
            expect(result.transactions).toHaveTransaction({
                from: aToken.address,
                to: aTokenWallet.address,
                success: true,
            });
            // aToken TokenExcesses
            expect(result.transactions).toHaveTransaction({
                from: aTokenWallet.address,
                to: pool.address,
                success: true,
            });
            expect(await pool.getBounceMsg(msgId)).toEqual(null);

            accountData = await userAccountContract.getAccount();
            // check user account
            expect(accountData.positionsLength).toEqual(1n);
            expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
            expect(accountData.positionsDetail?.get(sampleJetton.address)!!.supply).toEqual(amount);
            expect(accountData.positionsDetail?.get(sampleJetton.address)!!.asCollateral).toBeTruthy();
        });
    });
});

import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { Pool, UpdatePositionBounce } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { ATokenDefaultWallet } from '../build/AToken/tact_ATokenDefaultWallet';
import { AToken } from '../wrappers/AToken';
import { sumTransactionsFee } from '../jest.setup';
import { PERCENTAGE_FACTOR, RERUN_ACTION_UPDATE_POSITION } from '../helpers/constant';
import { parsePoolBounceMessage } from '../helpers/pool';
import { addReserve, deployJetton, deployPool, mintJetton } from './utils';

describe('Pool Supply', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let aToken: SandboxContract<AToken>;

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

        const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
        const { aTokenAddress } = await addReserve(pool, deployer, sampleJetton.address, poolWalletAddress);
        aToken = blockchain.openContract(await AToken.fromAddress(aTokenAddress));
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
                value: toNano('0.24'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                amount: amount,
                destination: pool.address,
                response_destination: deployerWalletAddress,
                custom_payload: null,
                forward_ton_amount: toNano('0.19'),
                forward_payload: forward_payload,
            },
        );

        // open this line to see the details
        // printTransactionFees(result.transactions);
        const totalTransactionFee = sumTransactionsFee(result.transactions);
        expect(totalTransactionFee).toBeLessThanOrEqual(0.12);

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

        // check user account
        const accountData = await userAccountContract.getAccount();
        expect(accountData.positionsLength).toEqual(1n);
        expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.supply).toEqual(amount);
        expect(accountData.positionsDetail?.get(sampleJetton.address)!!.asCollateral).toBeTruthy();
    };

    describe('handle supply', () => {
        it('should handle jetton supply successfully', async () => {
            const amount = toNano(100n);
            await supplyJetton(amount);
        });

        it('should handle ton supply successfully', async () => {
            await addReserve(pool, deployer, pool.address, pool.address);
            const userAccountContract = blockchain.openContract(
                await UserAccount.fromInit(pool.address, deployer.address),
            );
            const userAccountAddress = userAccountContract.address;

            const amount = toNano(100);
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('100.25'),
                },
                {
                    $$type: 'SupplyTon',
                    amount,
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

            // check user account
            const accountData = await userAccountContract.getAccount();
            expect(accountData.positionsLength).toEqual(1n);
            expect(accountData.positions?.get(0n)!!.equals(pool.address)).toBeTruthy();
            expect(accountData.positionsDetail?.get(pool.address)!!.supply).toEqual(amount);
            expect(accountData.positionsDetail?.get(pool.address)!!.asCollateral).toBeTruthy();
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

            const userAccountContract = blockchain.openContract(
                await UserAccount.fromInit(pool.address, deployer.address),
            );

            const borrowAmount = toNano(50n);
            let result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.4'),
                },
                {
                    $$type: 'BorrowToken',
                    tokenAddress: sampleJetton.address,
                    amount: borrowAmount,
                },
            );

            const reserveData = await pool.getReserveDataAndConfiguration(sampleJetton.address);
            const { price } = reserveData.reserveData;
            const { liquidationThreshold } = reserveData.reserveConfiguration;

            const maxATokenTransferAmount =
                amount - (borrowAmount * price * PERCENTAGE_FACTOR) / liquidationThreshold / price;

            result = await aTokenWallet.send(
                deployer.getSender(),
                {
                    value: toNano('1.5'),
                },
                {
                    $$type: 'TokenTransfer',
                    queryId: 1n,
                    amount: maxATokenTransferAmount,
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
                to: userAccountContract.address,
                success: true,
            });
            expect(result.transactions).toHaveTransaction({
                from: userAccountContract.address,
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
            expect(secondUserWalletData.balance).toEqual(maxATokenTransferAmount);
            expect(secondUserWalletData.master.toString()).toEqual(aToken.address.toString());
        });

        it('transfer AToken failed because of lower hf', async () => {
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

            const borrowAmount = toNano('50');
            let result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.4'),
                },
                {
                    $$type: 'BorrowToken',
                    tokenAddress: sampleJetton.address,
                    amount: borrowAmount,
                },
            );

            const userAccountContract = blockchain.openContract(
                await UserAccount.fromInit(pool.address, deployer.address),
            );

            const reserveData = await pool.getReserveDataAndConfiguration(sampleJetton.address);
            const { price } = reserveData.reserveData;
            const { liquidationThreshold } = reserveData.reserveConfiguration;

            const maxATokenTransferAmount =
                amount - (borrowAmount * price * PERCENTAGE_FACTOR) / liquidationThreshold / price;

            result = await aTokenWallet.send(
                deployer.getSender(),
                {
                    value: toNano('1.5'),
                },
                {
                    $$type: 'TokenTransfer',
                    queryId: 1n,
                    amount: maxATokenTransferAmount + 1n,
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
                to: userAccountContract.address,
                success: true,
            });
            // failed to transfer aToken because of lower hf
            expect(result.transactions).toHaveTransaction({
                from: userAccountContract.address,
                to: pool.address,
                success: false,
            });
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

        // Won't be able to bounce due to the gas check
        xit('UpdatePosition and MintAToken Bounce and rerun', async () => {
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
            const updatePositionMsg = parsePoolBounceMessage(await pool.getBounceMsg(msgId)) as UpdatePositionBounce;
            expect(updatePositionMsg?.$$type).toEqual('UpdatePositionBounce');
            expect(updatePositionMsg?.msg.queryId).toEqual(msgId);
            expect(updatePositionMsg?.user.toString()).toEqual(deployer.getSender().address.toString());
            expect(updatePositionMsg?.msg.address.toString()).toEqual(sampleJetton.address.toString());
            expect(updatePositionMsg?.msg.supply).toEqual(100000000000n);
            expect(updatePositionMsg?.msg.borrow).toEqual(0n);

            result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.15'),
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
                success: true,
            });
            expect(await pool.getBounceMsg(msgId)).toEqual(null);
            // rerun mint msg
            const aTokenWallet = blockchain.openContract(
                ATokenDefaultWallet.fromAddress(
                    await pool.getUserATokenWalletAddress(sampleJetton.address, deployer.getSender().address),
                ),
            );
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
            accountData = await userAccountContract.getAccount();
            // check user account
            expect(accountData.positionsLength).toEqual(1n);
            expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
            expect(accountData.positionsDetail?.get(sampleJetton.address)!!.supply).toEqual(amount);
            expect(accountData.positionsDetail?.get(sampleJetton.address)!!.asCollateral).toBeTruthy();
        });

        it('Should fail if not enough gas', async () => {
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
                    value: toNano('0.25'),
                },
                {
                    $$type: 'TokenTransfer',
                    queryId: 0n,
                    amount: amount,
                    destination: pool.address,
                    response_destination: deployerWalletAddress,
                    custom_payload: null,
                    forward_ton_amount: toNano('0.1'),
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
                // 55259: Insufficient fee
                exitCode: 55259,
                success: false,
            });
        });
    });
});

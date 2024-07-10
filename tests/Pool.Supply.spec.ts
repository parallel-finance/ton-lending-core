import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, beginCell, Cell, toNano } from '@ton/core';
import { Pool, ReserveConfiguration } from '../wrappers/Pool';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';

describe('Pool', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton: SandboxContract<SampleJetton>;

    const reserveAddress = address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV');

    const reserveConfiguration: ReserveConfiguration = {
        $$type: 'ReserveConfiguration',
        poolWalletAddress: reserveAddress,
        lTokenAddress: reserveAddress,
        dTokenAddress: reserveAddress,
        ltv: 6000n,
        liquidationThreshold: 750n,
        liquidationBonus: 500n,
        reserveFactor: 1000n,
        liquidationProtocolFee: 50n,
        optimalUsageRatio: 7000n,
        slope1: 1000n,
        slope2: 3000n,
        borrowingEnabled: true,
        supplyCap: 1000000n,
        borrowCap: 1000000n
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        pool = blockchain.openContract(await Pool.fromInit());

        deployer = await blockchain.treasury('deployer');

        // deploy pool
        const deployResult = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.05')
            },
            {
                $$type: 'Deploy',
                queryId: 0n
            }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            deploy: true,
            success: true
        });

        // deploy test jetton
        const jettonParams = {
            name: 'SampleJetton',
            description: 'Sample Jetton for testing purposes',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'SAM'
        };
        let max_supply = toNano(1000000n); // 🔴 Set the specific total supply in nano
        let content = buildOnchainMetadata(jettonParams);

        sampleJetton = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content, max_supply));

        await sampleJetton.send(
            deployer.getSender(),
            {
                value: toNano('0.05')
            },
            {
                $$type: 'Deploy',
                queryId: 0n
            }
        );

        // add reserve
        const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
        const result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.05')
            },
            {
                $$type: 'AddReserve',
                reserveAddress: sampleJetton.address,
                reserveConfiguration: {
                    ...reserveConfiguration,
                    poolWalletAddress
                }
            }
        );

        // mint test jetton to deployer
        await sampleJetton.send(
            deployer.getSender(),
            {
                value: toNano('0.05')
            },
            {
                $$type: 'Mint',
                amount: 100000000000n,
                receiver: deployer.address
            }
        );
    });

    describe('handle supply', () => {
        it('should handle supply successfully', async () => {
            const amount = toNano(100n);

            // transfer jetton to pool
            const deployerWalletAddress = await sampleJetton.getGetWalletAddress(deployer.address);
            const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);
            const deployerJettonDefaultWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(deployerWalletAddress));
            const forward_payload: Cell = beginCell()
                .storeUint(0x55b591ba, 32)
                .endCell();

            const userAccountContract = blockchain.openContract(await UserAccount.fromInit(pool.address, deployer.address));
            const userAccountAddress = userAccountContract.address;

            const result = await deployerJettonDefaultWallet.send(
                deployer.getSender(),
                {
                    value: toNano('0.1')
                },
                {
                    $$type: 'TokenTransfer',
                    queryId: 0n,
                    amount: amount,
                    destination: pool.address,
                    response_destination: deployerWalletAddress,
                    custom_payload: null,
                    forward_ton_amount: toNano('0.05'),
                    forward_payload: forward_payload
                }
            );
            console.log(`deployer.address: ${deployer.address}`);
            console.log(`deployerJettonDefaultWallet: ${deployerWalletAddress}`);
            console.log(`poolWalletAddress: ${poolWalletAddress}`);
            console.log(`poolAddress: ${pool.address}`);
            console.log(`userAccountAddress: ${userAccountAddress}`);

            /*
    deployer.address: EQBGhqLAZseEqRXz4ByFPTGV7SVMlI4hrbs-Sps_Xzx01x8G
    deployerJettonDefaultWallet: EQBzkoKwuiGsjC21aSZzL7rkeISXP_rwNPOQxMotdB-t1IfH
    poolWalletAddress: EQDXs5Y9VUa988QJ5rW0MXHf7sKrKdW6fEvz3amaXc5CbH-2
    poolAddress: EQBYOuZE7FA9LUvxSXaeQBB0O64ihtEJQPkvvLmcFbUNKPl-
    userAccountAddress: EQBGhqLAZseEqRXz4ByFPTGV7SVMlI4hrbs-Sps_Xzx01x8G
             */
            // TokenTransferInternal
            expect(result.transactions).toHaveTransaction({
                from: deployerWalletAddress,
                to: poolWalletAddress,
                success: true
            });

            // TransferNotification
            expect(result.transactions).toHaveTransaction({
                from: poolWalletAddress,
                to: pool.address,
                success: true
            });

            // UpdatePosition
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: userAccountAddress,
                success: true
            });

            // check user account
            const accountData = await userAccountContract.getAccount();
            expect(accountData.positionsLength).toEqual(1n);
            expect(accountData.positions?.get(0n)!!.equals(sampleJetton.address)).toBeTruthy();
            expect(accountData.positionsDetail?.get(sampleJetton.address)!!.supply).toEqual(amount);
            expect(accountData.positionsDetail?.get(sampleJetton.address)!!.asCollateral).toBeTruthy();
        });

        it('should fail if the jetton is not configured', async () => {
        });
    });
});

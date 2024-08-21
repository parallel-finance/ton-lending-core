import '@ton/test-utils';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonWallet } from '../wrappers/JettonWallet';
import { RewardJettonMaster } from '../wrappers/RewardJettonMaster';
import { compile } from '@ton/blueprint';

describe('RewardJetton', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let sampleRewardJettonMaster: SandboxContract<RewardJettonMaster>;
    let sampleJettonWallet: SandboxContract<JettonWallet>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        const jettonParams = {
            name: 'SampleJetton',
            description: 'Sample Jetton for testing purposes',
            decimals: '9',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'SAM',
        };

        // It's the largest value I can use for max_supply in the tests
        let content = buildOnchainMetadata(jettonParams);

        const walletCode = await compile('JettonWallet');
        const masterCode = await compile('RewardJettonMaster');
        sampleRewardJettonMaster = blockchain.openContract(RewardJettonMaster.createFromConfig(
            {
                admin: deployer.address,
                content,
                walletCode,
            },
            masterCode
        ));
        sampleJettonWallet = blockchain.openContract(JettonWallet.createFromConfig(
            {
                owner: deployer.address,
                minter: sampleRewardJettonMaster.address,
                walletCode,
            },
            walletCode
        ));

        const deployResult = await sampleRewardJettonMaster.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: sampleRewardJettonMaster.address,
            deploy: true,
            success: true,
        });
    });

    describe("should run", () => {
        it("should deploy jetton master and jetton wallet successfully", async () => {
            const jettonData = await sampleRewardJettonMaster.getJettonData();
            expect(jettonData.totalSupply).toEqual(0n);
            expect(jettonData.mintable).toEqual(true);
            expect(jettonData.adminAddress.toString()).toEqual(deployer.getSender().address.toString());
            expect(jettonData.content).toEqual(jettonData.content);

            const calculatedWalletAddress = await sampleRewardJettonMaster.getWalletAddress(deployer.address);
            expect(calculatedWalletAddress.toString()).toEqual(sampleJettonWallet.address.toString());
        })
    })

    // NOTE: discovery is disabled in RewardJettonMaster
    // describe('discover', () => {
    //     it('should discover wallet address successfully', async () => {
    //         const receiverAddress = (await blockchain.createWallets(1))[0].address;

    //         // should be failed due to insufficient funds
    //         const result = await sampleRewardJettonMaster.sendDiscovery(
    //             deployer.getSender(),
    //             receiverAddress,
    //             true,
    //             toNano('0.01'),
    //         );
    //         expect(result.transactions).toHaveTransaction({
    //             to: sampleRewardJettonMaster.address,
    //             inMessageBounced: false,
    //             inMessageBounceable: true,
    //             success: false,
    //             exitCode: Errors.insufficient_discovery_fee,
    //         });
    //         expect(result.transactions).toHaveTransaction({
    //             from: sampleRewardJettonMaster.address,
    //             inMessageBounced: true,
    //             success: true,
    //         });

    //         // should be successful now due to sufficient funds
    //         const result2 = await sampleRewardJettonMaster.sendDiscovery(
    //             deployer.getSender(),
    //             receiverAddress,
    //             true,
    //             toNano('0.1'),
    //         );

    //         // provide_wallet_address message
    //         expect(result2.transactions).toHaveTransaction({
    //             to: sampleRewardJettonMaster.address,
    //             success: true,
    //         })
    //         // take_wallet_address message
    //         expect(result2.transactions).toHaveTransaction({
    //             from: sampleRewardJettonMaster.address,
    //             success: true,
    //         });
    //     });
    // });

    describe('mint', () => {
        it('should mint token successfully (mint -> internal_transfer -> transfer_notification)', async () => {
            const receiverAddress = (await blockchain.createWallets(1))[0].address;
            const result = await sampleRewardJettonMaster.sendMint(
                deployer.getSender(),
                receiverAddress,
                toNano('0.05'),
                toNano('0.05'),
                toNano('0.06'),
            );
            const receiverWalletAddress = await sampleRewardJettonMaster.getWalletAddress(receiverAddress);
            const balance = await blockchain.openContract(
                JettonWallet.createFromAddress(receiverWalletAddress),
            ).getJettonBalance();
            expect(balance).toEqual(toNano('0.05'));

            // mint message
            expect(result.transactions).toHaveTransaction({
                from: undefined,
                oldStatus: "active",
                endStatus: "active",
                success: true,
            });

            // internal transfer message
            expect(result.transactions).toHaveTransaction({
                from: sampleRewardJettonMaster.address,
                to: receiverWalletAddress,
                oldStatus: "uninitialized",
                endStatus: "active",
                inMessageBounceable: true,
                success: true,
            });

            // transfer_notification Message
            expect(result.transactions).toHaveTransaction({
                from: receiverWalletAddress,
                to: receiverAddress,
                oldStatus: "active",
                endStatus: "active",
                inMessageBounceable: false,
                success: true,
            });
        });

        // TODO: Implement mint_batch in FunC contract
        // it('should mint batch of tokens successfully', async () => {
        //     blockchain.verbosity = {
        //         print: true,
        //         blockchainLogs: true,
        //         vmLogs: 'vm_logs_full',
        //         debugLogs: true,
        //     }
        //     const wallets = await blockchain.createWallets(1);
        //     const records = Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigUint(256));
        //     wallets.forEach(wallet => records.set(wallet.address, toNano('0.66')));

        //     const result = await sampleRewardJettonMaster.sendMintBatch(
        //         deployer.getSender(),
        //         records,
        //     );

        //     const supply = await sampleRewardJettonMaster.getJettonData();
        //     expect(supply.totalSupply).toEqual(toNano('0.1'));

        //     expect(result.transactions).toHaveTransaction({
        //       from: sampleRewardJettonMaster.address,
        //       success: false,
        //     });
        // })
    })


    describe('transfer', () => {
        it("should transfer token successfully", async () => {
            const sender = deployer.getSender();
            const senderAddress = sender.address;
            const amount = toNano("1")
            const result = await sampleRewardJettonMaster.sendMint(
                sender,
                senderAddress,
                amount,
                toNano('0.05'),
                toNano('0.06'),
            );

            const senderWalletAddress = await sampleRewardJettonMaster.getWalletAddress(senderAddress);
            const balance = await blockchain.openContract(JettonWallet.createFromAddress(senderWalletAddress),).getJettonBalance();
            expect(balance).toEqual(toNano('1'));

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: sampleRewardJettonMaster.address,
                success: true,
            });

            const receiverAddress = (await blockchain.createWallets(1))[0].address;
            const receiverWalletAddress = await sampleRewardJettonMaster.getWalletAddress(receiverAddress);
            const receiverWallet = blockchain.openContract(JettonWallet.createFromAddress(receiverWalletAddress))
            const transferAmount = toNano("0.3")
            const transferResult = await sampleJettonWallet.sendTransfer(
                sender,
                toNano('0.05'),
                toNano('0.05'),
                receiverAddress,
                transferAmount,
                Cell.EMPTY,
            );

            // console.log({
            //     senderAddress: senderAddress.toString(),
            //     receiverAddress: receiverAddress.toString(),
            //     senderWalletAddress: senderWalletAddress.toString(),
            //     receiverWalletAddress: receiverWalletAddress.toString(),
            //     sampleRewardJettonMaster: sampleRewardJettonMaster.address.toString(),
            // })

            // external message
            expect(transferResult.transactions).toHaveTransaction({
                from: undefined,
                to: senderAddress,
                oldStatus: "active",
                endStatus: "active",
                outMessagesCount: 1,
                success: true,
            });

            // op::transfer message
            expect(transferResult.transactions).toHaveTransaction({
                from: senderAddress,
                to: senderWalletAddress,
                outMessagesCount: 1,
                success: true,
            });

            // op::transfer message
            expect(transferResult.transactions).toHaveTransaction({
                from: senderWalletAddress,
                to: receiverWalletAddress,
                outMessagesCount: 2, // op::transfer_notification & op::excesses
                oldStatus: "uninitialized",
                endStatus: "active",
                success: true,
            });

            // op::transfer_notification message
            expect(transferResult.transactions).toHaveTransaction({
                from: receiverWalletAddress,
                to: receiverAddress,
                success: true,
            });

            // op::excesses message
            expect(transferResult.transactions).toHaveTransaction({
                from: receiverWalletAddress,
                to: senderAddress,
                success: true,
            });

            const newWalletData = await receiverWallet.getJettonBalance();
            expect(newWalletData).toEqual(transferAmount);
        });
    })
});

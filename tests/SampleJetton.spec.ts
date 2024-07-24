import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';

describe('SampleJetton', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let sampleJetton: SandboxContract<SampleJetton>;

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
        let max_supply = (1n << 120n) - 1n;
        // let max_supply = toNano(1000000n); // 🔴 Set the specific total supply in nano
        let content = buildOnchainMetadata(jettonParams);

        sampleJetton = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content, max_supply));

        const deployResult = await sampleJetton.send(
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
            to: sampleJetton.address,
            deploy: true,
            success: true,
        });
    });

    describe('mint', () => {
        it('should mint token successfully', async () => {
            const receiverAddress = (await blockchain.createWallets(1))[0].address;
            const result = await sampleJetton.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'Mint',
                    queryId: 0n,
                    amount: 1000000000n,
                    receiver: receiverAddress,
                },
            );

            // Mint message
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: sampleJetton.address,
                success: true,
            });
            const receiverSampleJettonWalletAddress = await sampleJetton.getGetWalletAddress(receiverAddress);

            // Token transfer internal message
            expect(result.transactions).toHaveTransaction({
                from: sampleJetton.address,
                to: receiverSampleJettonWalletAddress,
                success: true,
            });

            // Excess message
            expect(result.transactions).toHaveTransaction({
                from: receiverSampleJettonWalletAddress,
                to: deployer.address,
                success: true,
            });

            const receiverSampleJettonWallet = blockchain.openContract(
                await JettonDefaultWallet.fromAddress(receiverSampleJettonWalletAddress),
            );
            const walletData = await receiverSampleJettonWallet.getGetWalletData();
            expect(walletData.balance).toEqual(1000000000n);
        });
    });
});

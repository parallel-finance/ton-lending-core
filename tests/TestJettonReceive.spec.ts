import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import '@ton/test-utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { TestJettonReceive } from '../wrappers/TestJettonReceive';

describe('TestJettonReceive', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let sampleJetton: SandboxContract<SampleJetton>;
    let testJettonReceive: SandboxContract<TestJettonReceive>;
    let deployerJettonWallet: SandboxContract<JettonDefaultWallet>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        const jettonParams = {
            name: 'SampleJetton',
            description: 'Sample Jetton for testing purposes',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'SAM',
        };
        let max_supply = toNano(1000000n); // 🔴 Set the specific total supply in nano
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

        await sampleJetton.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Mint',
                receiver: deployer.getSender().address,
                amount: toNano(100000),
            },
        );
        deployerJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await sampleJetton.getGetWalletAddress(deployer.getSender().address)),
        );
        expect((await deployerJettonWallet.getGetWalletData()).balance).toEqual(toNano(100000));

        testJettonReceive = blockchain.openContract(await TestJettonReceive.fromInit());
        await testJettonReceive.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 1n,
            },
        );
    });

    it('dump correct', async () => {
        const testJettonReceiveJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await sampleJetton.getGetWalletAddress(testJettonReceive.address)),
        );
        console.log('sampleJetton', sampleJetton.address.toString());
        console.log('testJettonReceiveJettonWallet', testJettonReceiveJettonWallet.address.toString());
        console.log('testJettonReceive owner', await testJettonReceive.getOwner());

        const rst = await testJettonReceive.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'SetOwnedJettonWallet',
                jettonMaster: sampleJetton.address,
                jettonWallet: testJettonReceiveJettonWallet.address,
            },
        );
        expect(rst.transactions).toHaveTransaction({
            from: deployer.address,
            to: testJettonReceive.address,
            success: true,
        });

        expect(
            (await testJettonReceive.getOwnedJettonWallet(testJettonReceiveJettonWallet.address))?.toString(),
        ).toEqual(sampleJetton.address.toString());

        await deployerJettonWallet.send(
            deployer.getSender(),
            {
                value: toNano('0.16'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 1n,
                amount: toNano(100),
                destination: testJettonReceive.address,
                response_destination: deployer.getSender().address!!,
                custom_payload: null,
                forward_ton_amount: toNano('0.1'),
                forward_payload: Cell.EMPTY,
            },
        );

        expect((await testJettonReceiveJettonWallet.getGetWalletData()).balance).toEqual(toNano(100));
    });
    it('dump error', async () => {
        const testJettonReceiveJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await sampleJetton.getGetWalletAddress(testJettonReceive.address)),
        );
        console.log('sampleJetton', sampleJetton.address.toString());
        console.log('testJettonReceiveJettonWallet', testJettonReceiveJettonWallet.address.toString());
        console.log('testJettonReceive owner', await testJettonReceive.getOwner());

        const rst = await testJettonReceive.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'SetOwnedJettonWallet',
                jettonMaster: sampleJetton.address,
                jettonWallet: sampleJetton.address,
            },
        );
        expect(rst.transactions).toHaveTransaction({
            from: deployer.address,
            to: testJettonReceive.address,
            success: true,
        });

        await deployerJettonWallet.send(
            deployer.getSender(),
            {
                value: toNano('0.16'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 1n,
                amount: toNano(100),
                destination: testJettonReceive.address,
                response_destination: deployer.getSender().address!!,
                custom_payload: null,
                forward_ton_amount: toNano('0.1'),
                forward_payload: Cell.EMPTY,
            },
        );

        expect((await testJettonReceiveJettonWallet.getGetWalletData()).balance).toEqual(toNano(100));

    });
});

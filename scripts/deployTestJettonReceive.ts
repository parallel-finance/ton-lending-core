import { NetworkProvider, sleep } from '@ton/blueprint';
import { TestJettonReceive } from '../wrappers/TestJettonReceive';
import { Address, Cell, toNano } from '@ton/core';
import { SampleJetton } from '../wrappers/SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';

export async function run(provider: NetworkProvider) {
    const testJettonReceive = provider.open(await TestJettonReceive.fromInit());
    const sender = provider.sender().address!!;
    console.log('sender', sender);
    console.log('testJettonReceive', testJettonReceive.address);

    await testJettonReceive.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Deploy',
            queryId: 0n,
        },
    );
    // await provider.waitForDeploy(testJettonReceive.address);
    await sleep(15000);

    // JettonMaster: EQAr3IDrE8qt9Fff-70ISYpTtNHZ9wR7lnV2atuC4aXoaS8E
    // Sender's JettonWallet: EQDW8fMsnkjO_SCr14ga9flECCzcDsJAcNg80udEwLvwSlyK
    const jetton = provider.open(
        SampleJetton.fromAddress(Address.parse('EQAr3IDrE8qt9Fff-70ISYpTtNHZ9wR7lnV2atuC4aXoaS8E')),
    );
    const senderJettonWallet = provider.open(
        JettonDefaultWallet.fromAddress(Address.parse('EQDW8fMsnkjO_SCr14ga9flECCzcDsJAcNg80udEwLvwSlyK')),
    );
    // EQDypiiCH4jD_mDkbdUPz5ezndIey53drt3tcbOEssjI_8jQ
    const testJettonReceiveJettonWallet = await jetton.getGetWalletAddress(testJettonReceive.address);
    console.log(`testJettonReceive's jetton wallet address`, testJettonReceiveJettonWallet.toString());
    await testJettonReceive.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'SetOwnedJettonWallet',
            jettonMaster: jetton.address,
            jettonWallet: testJettonReceiveJettonWallet,
        },
    );
    await sleep(15000);
    await senderJettonWallet.send(
        provider.sender(),
        {
            value: toNano('0.07'),
        },
        {
            $$type: 'TokenTransfer',
            queryId: 1n,
            amount: toNano(100),
            destination: testJettonReceive.address,
            response_destination: provider.sender().address!!,
            custom_payload: null,
            forward_ton_amount: toNano('0.02'),
            forward_payload: Cell.EMPTY,
        },
    );
}

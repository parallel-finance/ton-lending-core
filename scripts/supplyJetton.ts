import { address, beginCell, Cell, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    console.log(`Deployed Pool at ${pool.address.toString()}`);
    const reserveAddress = address('EQAFy5Wqx0HmUVQFcSTNpceFAVa8WikjyIUvWxdbqd0BsE6D');
    const sampleJetton = provider.open(SampleJetton.fromAddress(reserveAddress));
    const providerJettonWalletAddress = await sampleJetton.getGetWalletAddress(provider.sender().address!!);
    const providerJettonWallet = provider.open(JettonDefaultWallet.fromAddress(providerJettonWalletAddress));
    const walletDataBefore = await providerJettonWallet.getGetWalletData();
    console.log(`Provider Jetton Wallet balance(before): ${walletDataBefore.balance.toString()}`);

    const amount = toNano(100n);

    const forward_payload: Cell = beginCell()
        .storeUint(0x55b591ba, 32)
        .endCell();

    await providerJettonWallet.send(
        provider.sender(),
        {
            value: toNano('0.1')
        },
        {
            $$type: 'TokenTransfer',
            queryId: 0n,
            amount: amount,
            destination: pool.address,
            response_destination: providerJettonWalletAddress,
            custom_payload: null,
            forward_ton_amount: toNano('0.05'),
            forward_payload: forward_payload
        }
    );

    let walletData = await providerJettonWallet.getGetWalletData();
    let i = 0;
    while (walletData.balance === walletDataBefore.balance && i < 20) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('Waiting for balance update...');
        walletData = await providerJettonWallet.getGetWalletData();
        i++;
    }

    console.log(`Supply Jetton: ${amount.toString()} to Pool at ${pool.address.toString()}`);
}

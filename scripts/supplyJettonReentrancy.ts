import { address, beginCell, Cell, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';
import { SampleJetton, storeTokenTransfer } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { mnemonicToWalletKey } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';
import { senderArgsToMessageRelaxed } from './utils';
import { waitForTx } from '../helpers/address';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    // MAS
    const reserveAddress = address('EQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw2AU');
    const sampleJetton = provider.open(SampleJetton.fromAddress(reserveAddress));
    const providerJettonWalletAddress = await sampleJetton.getGetWalletAddress(provider.sender().address!!);
    const providerJettonWallet = provider.open(JettonDefaultWallet.fromAddress(providerJettonWalletAddress));
    const walletDataBefore = await providerJettonWallet.getGetWalletData();
    console.log(`Provider Jetton Wallet balance(before): ${walletDataBefore.balance.toString()}`);

    const amount = toNano(100n);

    const forward_payload: Cell = beginCell().storeUint(0x55b591ba, 32).endCell();

    const keyPair = await mnemonicToWalletKey(process.env.WALLET_MNEMONIC?.split(',') || []);
    const workchain = 0;
    const wallet = WalletContractV4.create({
        workchain,
        publicKey: keyPair.publicKey,
    });
    const userWalletContract = provider.open(wallet);

    const supplyMessage = senderArgsToMessageRelaxed({
        to: providerJettonWallet.address,
        value: toNano('0.25'),
        body: beginCell()
            .store(
                storeTokenTransfer({
                    $$type: 'TokenTransfer',
                    queryId: 0n,
                    amount: amount,
                    destination: pool.address,
                    // Should we use null or handle the Excess message?
                    response_destination: provider.sender().address!!,
                    custom_payload: null,
                    forward_ton_amount: toNano('0.15'),
                    forward_payload: forward_payload,
                }),
            )
            .endCell(),
    });

    await userWalletContract.sendTransfer({
        seqno: await userWalletContract.getSeqno(),
        secretKey: keyPair.secretKey,
        messages: [supplyMessage, supplyMessage],
    });

    await waitForTx(provider, userWalletContract.address);
}

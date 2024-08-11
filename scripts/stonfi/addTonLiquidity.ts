import { mnemonicToWalletKey } from '@ton/crypto';
import { NetworkProvider } from '@ton/blueprint';
import { toNano, Address, WalletContractV4, internal } from '@ton/ton';
import { DEX, pTON } from '@ston-fi/sdk';
import { TESTNET_ADDRESS } from '../../helpers/constant';
// TODO: not finish
export async function run(provider: NetworkProvider) {
    const keyPair = await mnemonicToWalletKey(process.env.WALLET_MNEMONIC?.split(',') || []);
    const workchain = 0;
    const wallet = WalletContractV4.create({
        workchain,
        publicKey: keyPair.publicKey,
    });
    const userWalletContract = provider.open(wallet);
    const userWalletAddress = wallet.address.toString();

    const mas = Address.parse('kQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw9ue');

    const router = provider.open(new DEX.v1.Router(TESTNET_ADDRESS.STONFI_V1_ROUTER));
    const proxyTon = pTON.v1.create(TESTNET_ADDRESS.pTON);

    const pool = provider.open(
        await router.getPool({
            token0: mas,
            token1: TESTNET_ADDRESS.pTON,
        }),
    );

    console.log(await pool.getPoolData());

    const txsParams = await Promise.all([
        router.getProvideLiquidityTonTxParams({
            userWalletAddress: userWalletAddress,
            proxyTon: proxyTon,
            sendAmount: toNano('0.1'),
            otherTokenAddress: mas,
            minLpOut: '1',
            queryId: 12345,
        }),
        router.getProvideLiquidityJettonTxParams({
            userWalletAddress: userWalletAddress,
            sendTokenAddress: mas,
            sendAmount: toNano('50'),
            otherTokenAddress: proxyTon.address,
            minLpOut: '1',
            queryId: 123456,
        }),
    ]);

    await userWalletContract.sendTransfer({
        seqno: await userWalletContract.getSeqno(),
        secretKey: keyPair.secretKey,
        messages: txsParams.map((tx) => internal(tx)),
    });
}

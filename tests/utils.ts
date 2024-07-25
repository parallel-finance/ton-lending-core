import { Address, address, beginCell, Cell, OpenedContract, Sender, toNano } from '@ton/core';
import { Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import { buildOnchainMetadata } from '../scripts/utils';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { Blockchain } from '@ton/sandbox';
import { TreasuryContract } from '@ton/sandbox/dist/treasury/Treasury';
import { SandboxContract } from '@ton/sandbox/dist/blockchain/Blockchain';
import { ATokenDTokenContents } from '../build/UserAccount/tact_UserAccount';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';

export type JettonParams = {
    name: string;
    description: string;
    decimals: string;
    image: string;
    symbol: string;
};

export const reserveAddress = address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV');

export const reserveConfiguration: ReserveConfiguration = {
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
    treasury: reserveAddress,
    decimals: 9n
};

export const reserveInterestRateStrategy: ReserveInterestRateStrategy = {
    $$type: 'ReserveInterestRateStrategy',
    optimalUsageRatio: BigInt(0.9 * 10 ** 27),
    maxUsageRatio: BigInt(10 ** 27) - BigInt(0.9 * 10 ** 27),
    baseBorrowRate: 0n,
    slope1: BigInt(0.04 * 10 ** 27),
    slope2: BigInt(0.6 * 10 ** 27),
};

export const deployPool = async (pool: SandboxContract<Pool>, deployer: SandboxContract<TreasuryContract>) => {
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
};

// able to deploy several different jettons
export const deployJetton = async (
    blockchain: Blockchain,
    deployer: SandboxContract<TreasuryContract>,
    jettonParams: JettonParams,
): Promise<SandboxContract<SampleJetton>> => {
    let max_supply = toNano(1000000n);
    let content = buildOnchainMetadata(jettonParams);
    const jetton = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content, max_supply));

    await jetton.send(
        deployer.getSender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Deploy',
            queryId: 0n,
        },
    );
    return jetton;
};

// able to add jetton and ton reserves
export const addReserve = async (
    pool: SandboxContract<Pool>,
    deployer: SandboxContract<TreasuryContract>,
    reserveAddress: Address,
    poolWalletAddress: Address,
) => {
    const aTokenJettonParams = {
        name: 'AToken',
        description: 'Jetton aToken',
        decimals: '9',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'aToken',
    };
    let aTokenContent = buildOnchainMetadata(aTokenJettonParams);

    const dTokenJettonParams = {
        name: 'DToken',
        description: 'Jetton dToken',
        decimals: '9',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'dToken',
    };
    const dTokenContent = buildOnchainMetadata(dTokenJettonParams);
    const contents: ATokenDTokenContents = {
        $$type: 'ATokenDTokenContents',
        aTokenContent,
        dTokenContent,
    };

    const calculateATokenAddress = await pool.getCalculateATokenAddress(contents.aTokenContent, reserveAddress);

    const calculateDTokenAddress = await pool.getCalculateDTokenAddress(contents.dTokenContent, reserveAddress);

    await pool.send(
        deployer.getSender(),
        {
            value: toNano('0.3'),
        },
        {
            $$type: 'AddReserve',
            reserveAddress,
            reserveConfiguration: {
                ...reserveConfiguration,
                aTokenAddress: calculateATokenAddress,
                dTokenAddress: calculateDTokenAddress,
                poolWalletAddress,
            },
            contents,
            reserveInterestRateStrategy,
        },
    );

    await pool.send(
        deployer.getSender(),
        {
            value: toNano('0.2'),
        },
        {
            $$type: 'SetMockOraclePrice',
            asset: reserveAddress,
            price: toNano('1'),
        },
    );

    return {
        aTokenAddress: calculateATokenAddress,
        dTokenAddress: calculateDTokenAddress,
    };
};

export const mintJetton = async (
    jetton: SandboxContract<SampleJetton>,
    via: Sender,
    receiver: Address,
    amount: bigint,
) => {
    await jetton.send(
        via,
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Mint',
            queryId: 0n,
            receiver,
            amount,
        },
    );
};

export const supplyJetton = async (
    fromJettonWallet: SandboxContract<JettonDefaultWallet>,
    deployer: SandboxContract<TreasuryContract>,
    poolAddress: Address,
    amount: bigint,
) => {
    const forward_payload: Cell = beginCell().storeUint(0x55b591ba, 32).endCell();
    await fromJettonWallet.send(
        deployer.getSender(),
        {
            value: toNano('3'),
        },
        {
            $$type: 'TokenTransfer',
            queryId: 0n,
            amount: amount,
            destination: poolAddress,
            response_destination: deployer.address,
            custom_payload: null,
            forward_ton_amount: toNano('2'),
            forward_payload: forward_payload,
        },
    );
};

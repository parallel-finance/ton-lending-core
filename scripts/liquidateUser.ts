import { Address, beginCell, Cell, Dictionary, Sender, toNano } from '@ton/core';
import { Pool, ReserveDataAndConfiguration, UserAccountData } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { RAY } from '../helpers/constant';
import { getAddressSeqno, waitNextSeqno } from './utils';

const getReserveIndexByAddress = async (provider: NetworkProvider, reserveAddress: Address) => {
    const pool = provider.open(await Pool.fromInit());
    const reserveLength = await pool.getReservesLength();
    const reserves = await pool.getReserves();
    for (let i = 0n; i < reserveLength; i++) {
        if (reserveAddress.equals(reserves.get(i)!!)) {
            return i;
        }
    }
    throw new Error(`Reserve address ${reserveAddress.toString()} not found`);
};

const getLargestDebtAndCollateralReserveData = async (
    userAccountData: UserAccountData,
    allReservesDataAndConfiguration: Dictionary<Address, ReserveDataAndConfiguration>,
) => {
    let largestDebtReserveAddress: Address;
    let largestCollateralReserveAddress: Address;
    let largestDebtValue = 0n;
    let largestCollateralValue = 0n;
    let largestDebtAmount = 0n;

    const { positionsLength, positions, positionsDetail } = userAccountData;
    for (let i = 0n; i < positionsLength; i++) {
        const position = positions.get(i)!!;
        const positionDetail = positionsDetail.get(position)!!;
        const { supply, borrow, asCollateral } = positionDetail;
        const price = allReservesDataAndConfiguration.get(position)!!.reserveData.price;
        const normalizedDebt = allReservesDataAndConfiguration.get(position)!!.normalizedDebt;
        const borrowValue = borrow * price;
        if (borrowValue > largestDebtValue) {
            largestDebtValue = borrowValue;
            largestDebtReserveAddress = position;
            largestDebtAmount = (borrow * normalizedDebt) / RAY;
        }
        const supplyValue = supply * price;
        if (asCollateral && supplyValue > largestCollateralValue) {
            largestCollateralValue = supplyValue;
            largestCollateralReserveAddress = position;
        }
    }

    return {
        largestDebtReserveAddress: largestDebtReserveAddress!!,
        largestCollateralReserveAddress: largestCollateralReserveAddress!!,
        largestDebtAmount: largestDebtAmount!!,
    };
};

const liquidateUser = async (provider: NetworkProvider, liquidator: Sender, userAddress: Address) => {
    const pool = provider.open(await Pool.fromInit());

    const userAccountContract = provider.open(await UserAccount.fromInit(pool.address, userAddress));
    const userAccountData: UserAccountData = await userAccountContract.getAccount();
    // const reservesLength = await pool.getReservesLength();
    // const reserves: Dictionary<bigint, Address> = await pool.getReserves();
    const allReservesDataAndConfiguration: Dictionary<Address, ReserveDataAndConfiguration> =
        await pool.getAllReserveDataAndConfiguration();
    const { largestDebtReserveAddress, largestCollateralReserveAddress, largestDebtAmount } =
        await getLargestDebtAndCollateralReserveData(userAccountData, allReservesDataAndConfiguration);
    const debtAmount = largestDebtAmount;

    const collateralReserveIndex = await getReserveIndexByAddress(provider, largestCollateralReserveAddress);

    const debtReserve = provider.open(SampleJetton.fromAddress(largestDebtReserveAddress!!));
    const liquidatorDebtReserveWallet = provider.open(
        JettonDefaultWallet.fromAddress(await debtReserve.getGetWalletAddress(liquidator.address!!)),
    );
    const forward_payload: Cell = beginCell()
        .storeUint(0x1f03e59a, 32) // Liquidate opcode: 0x1f03e59a
        .storeAddress(userAddress) // borrower
        .storeUint(collateralReserveIndex, 5) // collateral reserve Index
        .endCell();

    console.log(`debtAmount: ${debtAmount}`);
    console.log(`collateralReserveIndex: ${collateralReserveIndex}`);

    const beforeSeqno = await getAddressSeqno(liquidator.address!!);
    await liquidatorDebtReserveWallet.send(
        liquidator,
        {
            value: toNano('0.6'),
        },
        {
            $$type: 'TokenTransfer',
            queryId: 0n,
            amount: debtAmount,
            destination: pool.address,
            response_destination: liquidatorDebtReserveWallet.address,
            custom_payload: null,
            forward_ton_amount: toNano('0.5'),
            forward_payload: forward_payload,
        },
    );
    await waitNextSeqno(liquidator.address!!, beforeSeqno);
};

export async function run(provider: NetworkProvider) {
    const userAddress = Address.parse('EQBLg1M1Y6Qs_-1KHMXJqbSSA6oy1jpMgtwivcVkgCX_DsFw');
    await liquidateUser(provider, provider.sender(), userAddress);
}

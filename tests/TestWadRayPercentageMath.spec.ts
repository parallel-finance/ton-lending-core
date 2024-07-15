import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import '@ton/test-utils';
import { TestWadRayPercentageMath } from '../build/TestWadRayPercentageMath/tact_TestWadRayPercentageMath';

describe('TestWadRayMath and PercentageMath', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let math: SandboxContract<TestWadRayPercentageMath>;

    const WAD = BigInt(10 ** 18);
    const RAY = BigInt(10 ** 27);
    const WAD_RAY_RATIO = BigInt(10 ** 9);

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        math = blockchain.openContract(await TestWadRayPercentageMath.fromInit());

        const deployResult = await math.send(
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
            to: math.address,
            deploy: true,
            success: true,
        });
    });

    it('wadDiv', async () => {
        const a = BigInt(132131312312);
        const b = BigInt(213);
        const rst = await math.getWadDiv(a, b);
        const expected = BigInt(a / b);
        expect(BigInt(rst / WAD)).toEqual(expected);
    });

    it('wadMul', async () => {
        const a = BigInt(132131312312) * WAD;
        const b = BigInt(213);
        const rst = await math.getWadMul(a, b);
        const expected = BigInt((a * b) / WAD);
        expect(rst).toEqual(expected);
    });

    it('rayDiv', async () => {
        const a = BigInt(132131312312);
        const b = BigInt(213);
        const rst = await math.getRayDiv(a, b);
        const expected = BigInt(a / b);
        expect(BigInt(rst / RAY)).toEqual(expected);
    });

    it('rayMul', async () => {
        const a = BigInt(132131312312) * RAY;
        const b = BigInt(213);
        const rst = await math.getRayMul(a, b);
        const expected = BigInt((a * b) / RAY);
        expect(rst).toEqual(expected);
    });

    it('rayToWad', async () => {
        const a = BigInt(132131312312) * RAY;
        const rst = await math.getRayToWad(a);
        const expected = a / WAD_RAY_RATIO;
        expect(rst).toEqual(expected);
    });

    it('wadToRay', async () => {
        const a = BigInt(132131312312) * WAD;
        const rst = await math.getWadToRay(a);
        const expected = a * WAD_RAY_RATIO;
        expect(rst).toEqual(expected);
    });

    it('percentMul', async () => {
        const a = BigInt(132131312312) * WAD;
        const b = 3000n;
        const rst = await math.getPercentMul(a, b);
        const expected = a * b / 10000n;
        expect(rst).toEqual(expected);
    });
    
    it('percentDiv', async () => {
        const a = BigInt(132131312312) * WAD;
        const b = 3000n;
        const rst = await math.getPercentDiv(a, b);
        const expected = a * 10000n / b;
        expect(rst).toEqual(expected);
    });

    it('extends mutates', async () => {
        const ts = await math.getTestTs()
        expect(ts.a).toEqual(2n)
        const ts2 = await math.getGetTs()
        expect(ts2.a).toEqual(0n)
    })
});

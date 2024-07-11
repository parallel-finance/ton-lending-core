# ton-lending-core

## Project structure

-   `contracts` - source code of all the smart contracts of the project and their dependencies.
-   `wrappers` - wrapper classes (implementing `Contract` from ton-core) for the contracts, including any [de]serialization primitives and compilation functions.
-   `tests` - tests for the contracts.
-   `scripts` - scripts used by the project, mainly the deployment scripts.

## How to use

### Build

`npx blueprint build` or `yarn blueprint build`

### Test

`npx blueprint test` or `yarn blueprint test`

### Deploy or run another script

`npx blueprint run` or `yarn blueprint run`

### Add a new contract

`npx blueprint create ContractName` or `yarn blueprint create ContractName`

## Functions

### Admin

The admin is the owner of the pool. The admin can manage the pool.

The admin can perform the following actions:
- The admin can support a new token in the pool
- The admin can remove a token from the pool
- The admin can change the configs like fee/ltv for the pool
- The admin can stop/resume the pool
- The admin can mint collected fees to the treasury as lToken

### Liquidity provider and borrower

Once the token is supplied to the pool, the liquidity provider will receive the aToken(Asset token).
The aToken can be used to withdraw the liquidity from the pool.
The ratio of lToken to token will increase as time passes because of the interest.

The liquidity provider can perform the following actions:
- The liquidity provider can deposit liquidity in the pool
- The liquidity provider can withdraw liquidity from the pool

The borrower can borrow the tokens from the pool by depositing the collateral in the pool.
The borrower will receive the dToken(Debt token) which represents the debt of the borrower.
The ratio of dToken to token will increase as time passes because of the interest.

- The borrower can borrow the tokens from the pool
- The borrower can repay the borrowed tokens to the pool

### Liquidator

The liquidator can liquidate the position of the borrower if the borrower's position is undercollateralized.

The liquidator can perform the following actions:
- The liquidator can liquidate the position of the borrower. The liquidator can only liquidate one position at a time.

## Release

- Before deploying to the mainnet, make sure to update the compiler 

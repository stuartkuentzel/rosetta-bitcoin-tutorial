import React, { useEffect, useState, useCallback } from 'react';
import { Button, Container, Message, Grid, Header } from 'semantic-ui-react'
import * as bip39 from 'bip39'
import * as Bitcoin from 'bitcoinjs-lib'
import { AccountBalanceResponse, ConstructionDeriveRequest, RosettaClient } from '@lunarhq/rosetta-ts-client'
import SendBitcoinForm from './SendBitcoinForm'
import { NETWORK_IDENTIFIER } from './constants'
import TxList from './TxList'

export type WalletViewProps = {
  phrase: string
}

const WalletView = ({
  phrase,
}: WalletViewProps) => {

  const [state, setState] = useState<{
    btcKeys: null | Bitcoin.ECPairInterface, 
    rosettaClient: RosettaClient,
    address: string,
    balance: string,
    txs: {
      hash: string,
      amount: number
    }[]
  }>({
    btcKeys: null, 
    rosettaClient: new RosettaClient({baseUrl: 'https://api.lunar.dev/v1', headers: { 'X-Api-Key': '1kdtEYp3HMm226RyMC33cgoSiAr' }}),
    address: '',
    balance: '',
    txs: []
  });

  const getBtcKeys = useCallback( (): Bitcoin.ECPairInterface => {
    const derive_path = "84'/1'/0'/0/0"
    const seed = bip39.mnemonicToSeedSync(phrase)
    const master = Bitcoin.bip32.fromSeed(seed, Bitcoin.networks.testnet).derivePath(derive_path)

    if (!master.privateKey) {
      throw new Error('Could not get private key from phrase')
    }
  
    return Bitcoin.ECPair.fromPrivateKey(master.privateKey, { network: Bitcoin.networks.testnet })
  }, [phrase])

  const deriveAddress = useCallback( async (btcKeys: Bitcoin.ECPairInterface): Promise<void> => {

    try {
      const deriveRequest: ConstructionDeriveRequest = {
        network_identifier: NETWORK_IDENTIFIER,
        public_key: {
          hex_bytes: btcKeys.publicKey.toString('hex'),
          curve_type: 'secp256k1',
        },
        metadata: {},
      }
      const res = await state.rosettaClient.derive(deriveRequest)
      setState(prevState => ({ ...prevState, address: res.address ?? '' }))
    } catch (error) {
      return Promise.reject(error)
    }
  }, [state.rosettaClient])

  const getAccountBalance = useCallback( async() => {

    if (state.address.length > 0) {

      const rosettaAccountBalance: AccountBalanceResponse = await state.rosettaClient.accountBalance({
        account_identifier: {
          address: state.address
        },
        network_identifier: NETWORK_IDENTIFIER,
      })
      setState(prevState => ({ ...prevState, balance: rosettaAccountBalance.balances[0].value }))

    }

  }, [state.address, state.rosettaClient])

  const fetchAccountData = useCallback(async (btcKeys: Bitcoin.ECPairInterface) => {
    /**
     * Derive Address from key
     */
    await deriveAddress(btcKeys)

    /**
     * Fetch Balance
     */
    await getAccountBalance()
  }, [deriveAddress, getAccountBalance])

  useEffect( () => {
    /**
     * Set BTC Keys
     */
    const btcKeys = getBtcKeys()
    setState(prevState => ({ ...prevState, btcKeys }))

    fetchAccountData(btcKeys)

  }, [getBtcKeys, fetchAccountData])

  const handleTransactionSuccess = (tx: {hash: string, amount: number}): void => {
    const txs = state.txs
    txs.push(tx)
    setState(prevState => ({...prevState, txs}))
  }

  return (
    <Container>
      <Message info>
        
        <Message.Header>Phrase</Message.Header>
        <p>
          {phrase}
        </p>
        <p>
          <i>*This is super sensitive info! Only visible for the purposes of this tutorial.</i>
        </p>
        <Message.Header>Address</Message.Header>
        <p>
          {state.address}
        </p>
        <Message.Header>Balance</Message.Header>
        <p>
          {+state.balance / (10**8)}
        </p>

        {state.address !== ''
          ? <Button circular icon='refresh' onClick={() => getAccountBalance()} />
          : <Button loading>Loading</Button>
        }
      </Message>
      <Grid columns={2} divided>
        <Grid.Row>
          <Grid.Column>
          {state.btcKeys != null &&
            <div>
              <Header size="small">Send Testnet BTC</Header>
              <SendBitcoinForm btcKeys={state.btcKeys} userAddress={state.address} rosettaClient={state.rosettaClient} transactionSuccess={handleTransactionSuccess} />
            </div>
          }
          </Grid.Column>
          <Grid.Column>
            <Header size="small">Session Sent Transactions</Header>
            <TxList txs={state.txs} />
          </Grid.Column>
        </Grid.Row>
      </Grid>
    </Container>
  );
}

export default WalletView;

// bag ship planet iron army punch donor laundry city vault pepper autumn
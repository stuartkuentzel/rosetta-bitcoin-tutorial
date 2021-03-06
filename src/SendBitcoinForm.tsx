import React, { useState } from 'react';
import * as Bitcoin from 'bitcoinjs-lib'
import { Form, Button } from 'semantic-ui-react'
import { Coin, ConstructionCombineRequest, ConstructionCombineResponse, ConstructionMetadataResponse, ConstructionPayloadsResponse, ConstructionPreprocessResponse, Operation, RosettaClient, Signature, TransactionIdentifierResponse } from '@lunarhq/rosetta-ts-client';
import { NETWORK_IDENTIFIER } from './constants'

export type SendBitcoinFormProps = {
  btcKeys: Bitcoin.ECPairInterface,
  rosettaClient: RosettaClient,
  userAddress: string,
  transactionSuccess(tx: {hash: string, amount: number}): void
}

const SendBitcoinForm = ({
  btcKeys,
  rosettaClient,
  userAddress,
  transactionSuccess
}: SendBitcoinFormProps) => {

  const [state, setState] = useState<{
    ops: Operation[],
    amount: number | null,
    recipient: string,
    coins: Coin[],
    submittingTx: boolean
  }>({
    ops: [],
    amount: null,
    recipient: '',
    coins: [],
    submittingTx: false
  })

  const createOps = (params: {
    fee: number
    coins: Coin[]
  }): Operation[] => {

    const { fee, coins } = params
    const amount = (state.amount ? state.amount * (10**8): 0)
    const testnetBtcSymbol = 'tBTC'
    const inputs = coins.reduce( (inputs: Operation[], coin, index) => {
      const totalInputsAmount = calculateOperationValue(inputs)
      
      if (inputs.length < 1 || totalInputsAmount < (amount + fee)) {
        const input: Operation = {
          operation_identifier: {
            index: index,
          },
          type: 'INPUT',
          account: {
            address: userAddress,
          },
          amount: {
            value: `-${coin.amount.value}`,
            currency: {
              symbol: coin.amount.currency.symbol,
              decimals: 8,
            },
          },
          coin_change: {
            coin_action: 'coin_spent',
            coin_identifier: coin.coin_identifier,
          },
        }
        inputs.push(input)
      }
      return inputs

    }, [])
    const totalInputsAmount = calculateOperationValue(inputs)
    const ops = [
      ...inputs,
      {
        operation_identifier: {
          index: inputs.length,
        },
        type: 'OUTPUT',
        account: {
          address: state.recipient,
        },
        amount: {
          value: `${amount}`,
          currency: {
            symbol: testnetBtcSymbol,
            decimals: 8,
          },
        },
      },
      {
        operation_identifier: {
          index: inputs.length + 1,
        },
        type: 'OUTPUT',
        account: {
          address: userAddress,
        },
        amount: {
          value: `${+totalInputsAmount - amount - fee}`,
          currency: {
            symbol: testnetBtcSymbol,
            decimals: 8,
          },
        },
      },
    ]
    return ops
  }

  const calculateOperationValue = (ops: Operation[]): number => {
    const totalOpsAmount = ops.reduce( (amount, input) => {
      amount += input.amount ? Math.abs(+input.amount?.value) : 0
      return amount
    }, 0)
    return totalOpsAmount
  }

  /**
   * Fetch Account Coins
   * https://www.rosetta-api.org/docs/AccountApi.html#accountcoins
   */
  const fetchAccountCoins = async (): Promise<Coin[]> => {
    if (userAddress.length > 0) {
      try {
        const accountCoinsResponse = await rosettaClient.accountCoins({
          network_identifier: NETWORK_IDENTIFIER,
          account_identifier: {
            address: userAddress
          },
          include_mempool: false
        })
        return accountCoinsResponse.coins
      } catch (error) {
        return Promise.reject(error)
      }
    } else {
      return Promise.reject('No user address found')
    }
  }

  /**
   * Preprocess
   * @param ops
   * https://www.rosetta-api.org/docs/ConstructionApi.html#constructionpreprocess
   */
  const constructionPreprocess = async (ops: Operation[]): Promise<ConstructionPreprocessResponse> => {
    try {
      return await rosettaClient.preprocess({
        network_identifier: NETWORK_IDENTIFIER,
        operations: ops,
      })
    } catch (error) {
      throw new Error(error)
    }
  }

  /**
   * Construction Metadata
   * @param preprocessRes 
   * https://www.rosetta-api.org/docs/ConstructionApi.html#constructionmetadata
   */
  const constructionMetadata = async (preprocessRes: ConstructionPreprocessResponse): Promise<ConstructionMetadataResponse> => {
    try {
      const body = {
        network_identifier: NETWORK_IDENTIFIER,
        options: preprocessRes.options ?? {},
      }

      return await rosettaClient.metadata(body)
    } catch (error) {
      throw new Error(error)
    }
  }

  /**
   * Construction Paylods
   * https://www.rosetta-api.org/docs/ConstructionApi.html#constructionpayloads
   */
  const constructionPayloads = async (p: {
    metadataRes: ConstructionMetadataResponse
    ops: Operation[]
  }): Promise<ConstructionPayloadsResponse> => {
    try {
      const { metadataRes, ops } = p
      const body = {
        network_identifier: NETWORK_IDENTIFIER,
        metadata: metadataRes.metadata,
        operations: ops,
      }
      const payloadsRes = await rosettaClient.payloads(body)
      return payloadsRes
    } catch (error) {
      throw new Error(error)
    }
  }

  /**
   * Construction Parse
   * https://www.rosetta-api.org/docs/ConstructionApi.html#constructionparse
   */
  const constructionParse = async (params: { signed: boolean; transaction: string }) => {
    const { signed, transaction } = params

    try {
      const body = {
        network_identifier: NETWORK_IDENTIFIER,
        signed: signed,
        transaction: transaction,
      }
      return rosettaClient.parse(body)
    } catch (error) {
      throw new Error(error)
    }
  }

  // compare two arrays of operations to make sure they match
  const operationsEqual = (intent: Operation[], operations: Operation[]): boolean => {

    // ensure lengths match
    if (intent.length !== operations.length) {
      return false;
    }

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const intentOp = intent[i];

      // check addresses match
      if (op.account?.address !== intentOp.account?.address) {
        return false
      }

      // check if ammounts match
      if (op.amount?.value !== intentOp.amount?.value) {
        return false
      }

      // check ammount currency type
      if (op.amount?.currency.symbol !== intentOp.amount?.currency.symbol) {
        return false
      }

      // check op types
      if (op.type !== intentOp.type) {
        return false
      }
    }

    return true

  }

  /**
   * Construction Combine
   * @param payloadsRes 
   * https://www.rosetta-api.org/docs/ConstructionApi.html#constructioncombine
   */
  const constructionCombine = async (payloadsRes: ConstructionPayloadsResponse): Promise<ConstructionCombineResponse> => {
    try {
      const signatures: Signature[] = payloadsRes.payloads.map( (payload) => ({
        hex_bytes: btcKeys.sign(Buffer.from(payload.hex_bytes, 'hex')).toString('hex'),
        signing_payload: payload,
        public_key: {
          hex_bytes: btcKeys.publicKey.toString('hex'),
          curve_type: 'secp256k1',
        },
        signature_type: 'ecdsa',
      }))

      const combineBody: ConstructionCombineRequest = {
        network_identifier: NETWORK_IDENTIFIER,
        unsigned_transaction: payloadsRes.unsigned_transaction,
        signatures: signatures
      }

      return await rosettaClient.combine(combineBody)
    } catch (error) {
      throw new Error(error)
    }
  }

  /**
   * Construction Hash
   * @param signedTx 
   * https://www.rosetta-api.org/docs/ConstructionApi.html#constructionhash
   */
  const constructionHash = async (signedTx: string): Promise<TransactionIdentifierResponse> => {
    try {
      const body = {
        network_identifier: NETWORK_IDENTIFIER,
        signed_transaction: signedTx,
      }
      return await rosettaClient.hash(body)
    } catch (error) {
      throw new Error(error)
    }
  }

  /**
   * Construction Submit
   * @param signedTx 
   * https://www.rosetta-api.org/docs/ConstructionApi.html#constructionsubmit
   */
  const constructionSubmit = async (signedTx: string): Promise<TransactionIdentifierResponse> => {
    try {
      const body = {
        network_identifier: NETWORK_IDENTIFIER,
        signed_transaction: signedTx,
      }
      return await rosettaClient.submit(body)
    } catch (error) {
      throw new Error(error)
    }
  }

  const handleSendBitcoinSubmit = async (): Promise<void> => {
    try {

      setState(prevState => ({...prevState, submittingTx: true}))

      const coins = await fetchAccountCoins()

      if (!coins || (coins && coins.length < 1)) {
        return Promise.reject('no account coins found')
      }
      /**
       * Use this to fetch an estimated fee
       */
      const preprocessOps = createOps({fee: 0, coins})

      /**
       * Preprocess ops
       */
      const preprocessResponse = await constructionPreprocess(preprocessOps)

      /**
       * Transaction Metadata
       */
      const metadataResponse = await constructionMetadata(preprocessResponse)

      if (!metadataResponse.suggested_fee || metadataResponse.suggested_fee.length < 1 ) {
        return Promise.reject('no suggested fee found')
      }

      /**
       * Rebuild operations with suggested fee
       */
      const ops = createOps({
        coins,
        fee: +metadataResponse.suggested_fee[0].value 
      })

      /**
       * Construct Payloads to sign
       */
      const payloads = await constructionPayloads({ ops, metadataRes: metadataResponse })

      /**
       * Parse Unsigned to confirm correctness
       */
      const parsedUnsigned = await constructionParse({
        signed: false,
        transaction: payloads.unsigned_transaction,
      })

      /**
       * Check unsigned operations from construction parse match the intent
       */
      if (!operationsEqual(parsedUnsigned.operations, ops)) {
        return Promise.reject('Unsigned Parsed Operations do not match')
      }

      /**
       * Combine
       */
      const combine = await constructionCombine(payloads)

      /**
       * Parse Signed Tx to confirm correctness
       */
      const parseSigned = await constructionParse({
        signed: true,
        transaction: combine.signed_transaction,
      })

      /**
       * Check signed operations from construction parse match the intent
       */
      if (!operationsEqual(parseSigned.operations, ops)) {
        return Promise.reject('Signed Parsed Operations do not match')
      }

      /**
       * Get Hash of Signed Tx
       */
      const hashRes = await constructionHash(combine.signed_transaction)

      /**
       * Submit Transaction
       */
      const submitRes = await constructionSubmit(combine.signed_transaction)

      if (submitRes.transaction_identifier.hash !== hashRes.transaction_identifier.hash) {
        return Promise.reject(
          'Submitted transaction identifier does not match Construction Hash transaction identifier',
        )
      }

      const tx = {
        hash: submitRes.transaction_identifier.hash,
        amount: state.amount ?? 0
      }
      transactionSuccess(tx)
      setState(prevState => ({
        ...prevState, 
        submittingTx: false,
        amount: null,
        recipient: ''
      }))
      
    } catch (error) {
      setState(prevState => ({...prevState, submittingTx: false}))
      return Promise.reject(error)
    }
  }

  return(
    <Form onSubmit={handleSendBitcoinSubmit}>
      <Form.Field>
        <label>Recipient Address</label>
        <input 
          placeholder='tb1qm5tfegjevj27yvvna9elym9lnzcf0zraxgl8z2' 
          value={state.recipient} 
          onChange={e => setState(prevState => ({...prevState, recipient: e.target.value}))} />
      </Form.Field>
      <Form.Field>
        <label>Amount</label>
        <input 
          placeholder='1 tBTC' 
          type="number"
          value={state.amount ?? ''} 
          onChange={ e => setState(prevState => {
            const val = e.target.value.length > 0 ? +e.target.value : null ;
            return {...prevState, amount: val}
          }) } />
      </Form.Field>
      <Button primary type='submit' disabled={
        state.recipient.length < 27 
        || !state.amount 
        || state.amount <= 0
        || state.submittingTx}>Send tBTC</Button>
    </Form>
  )

}

export default SendBitcoinForm
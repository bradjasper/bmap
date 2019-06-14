const bmap = {}

Map.prototype.getKey = function (searchValue) {
  for (let [key, value] of this.entries()) {
    if (value === searchValue)
      return key
  }
  return null
}

// Takes a bitdb formatted op_return transaction
bmap.TransformTx = (tx) => {
  if (!tx || !tx.hasOwnProperty('in') || !tx.hasOwnProperty('out')) {
    throw new Error('Cant process tx', tx)
  }

  let protocolMap = new Map()
  protocolMap.set('B','19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut')
  protocolMap.set('MAP','1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5')
  protocolMap.set('META', 'META')
  protocolMap.set('AIP','15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva')
      
  let querySchema = {
    'B': [
      { 'content': ['string', 'binary'] },
      { 'content-type': 'string' },
      { 'encoding': 'string' }, // we use this field to determine content character encoding. If encoding is not a valid character encoding (gzip), we assume it is binary
      { 'filename': 'string' }
    ],
    'MAP': [
      { 'cmd': 'string' },
      [
        { 'key': 'string' },
        { 'val': 'string' }
      ]
    ],
    'METANET': [

    ],
    'AIP': [
      { 'algorithm': 'string' },
      { 'address': 'string' },
      { 'signature': 'binary' },
      [
        {'index': 'string'}
      ]
    ]
  }

  // This will become our nicely formatted response object
  let dataObj = {}

  // offsets record the position of each protocol
  let offsets = new Map()

  // We always know what the first protocol is, it's always in s1
  let prefix = tx.out.filter(tx => { return tx && tx.b0.op === 106 })[0].s1

  // If s1 does not contain a protocol prefix, there's nothing to do
  if (!protocolMap.getKey(prefix)) {
    throw new Error('Unrecognized transaction', tx)
  }

  let protocolName = protocolMap.getKey(prefix)

  // Loop over the tx keys (in, out, tx, blk ...)
  for (let key of Object.keys(tx)) {
    // Check for op_return
    if (key === 'out' && tx.out.some((output) => { return output && output.b0 && output.b0.op === 106 })) {
      // There can be only one
      let opReturnOutput = tx[key][0]

      // FIRST, we separate the string, key, and binary values
      let valueMaps = {
        'binary': new Map(),
        'string': new Map(),
        'hex': new Map()
      }

      let otherVals = {}
      let indexCount = 0
      let roundIndex = 0

      for (let pushdataKey in opReturnOutput) {
        // Get the TXO index number by itself (strip letters)
        let num = parseInt(pushdataKey.replace(/[A-Za-z]/g,''))
        if (num >= 0) {
          if (pushdataKey.startsWith('s') || pushdataKey.startsWith('ls')) {
            valueMaps.string.set(num, opReturnOutput[pushdataKey])
          } else if(pushdataKey.startsWith('b') || pushdataKey.startsWith('lb')) {
            valueMaps.binary.set(num, opReturnOutput[pushdataKey])
          } else if(pushdataKey.startsWith('h') || pushdataKey.startsWith('lh')) {
            valueMaps.hex.set(num, opReturnOutput[pushdataKey])
          }
          if (num > indexCount) {
            indexCount = num
          }
        } else {
          otherVals[pushdataKey] = opReturnOutput[pushdataKey]
        }
      }

      console.log('Value Maps', valueMaps)
      // Loop for pushdata count and find appropriate value
      let relativeIndex = 0
      for (let x = 0; x <= indexCount; x++) {

        if (relativeIndex === 0 && protocolMap.getKey(valueMaps.string.get(x + 1))) {
          protocolName = protocolMap.getKey(valueMaps.string.get(x + 1))
          dataObj[protocolName] = {}
          offsets.set(protocolName, x+1)
          continue
        }

        // Detect UNIX pipeline
        if (valueMaps.string.get(x+1) === '|') {
          // console.log('========================= End', protocolName)
          relativeIndex = 0
          continue
        }

        let encoding
        if (relativeIndex !== 0) {
          // get the schema object, or array of objects in case of repeating fields
          let schemaField = querySchema[protocolName][relativeIndex-1]
          if (!schemaField) { throw new Error('Failed to find schema field for ', protocolName) }

          let obj = {}

          if (schemaField instanceof Array) {
            // loop through the schema as we add values
            roundIndex = roundIndex % schemaField.length
            let thekey = Object.keys(schemaField[roundIndex++])[0]
            encoding = Object.values(schemaField[roundIndex++])[0]
            obj[thekey] = valueMaps[encoding].get(x)

            dataObj[protocolName][thekey] = obj[thekey]
            continue
          } else {
            // get the key, value pair from this query schema
          
            let schemaKey = Object.keys(schemaField)[0]
            let schemaEncoding = Object.values(schemaField)[0]

            // B has many encoding possibilities for content, look in index 2 relative to the protocol schema
            if (schemaEncoding instanceof Array) {                
              // if encoding field if not included in content array assume its binary
              let encodingLocation = 's' + (offsets.get(protocolName) + 2 + relativeIndex)
              encoding = schemaEncoding.includes(opReturnOutput[encodingLocation]) ? opReturnOutput[encodingLocation] : 'binary'

            } else {
              encoding = schemaEncoding
            }
            
            // attach correct value to the output object
            obj[schemaKey] = valueMaps[encoding].get(x)
            dataObj[protocolName][schemaKey] = obj[schemaKey]
            relativeIndex++
          }
        } else {
          relativeIndex++
        }
      }

      // TRANSFORM MAP from {key: "keyname", val: "myval"} to {keyname: 'myval'}
      let keyTemp
      let newMap = {}
      if (dataObj.hasOwnProperty('MAP')) {
        let i = 0
        for (let kv of dataObj.MAP) {
          let key = Object.keys(kv)[0]
          let value = Object.values(kv)[0]
          if (key === 'cmd') { newMap.cmd = value; continue }
          if (i % 2 === 0) {
            keyTemp = value
          } else {
            newMap[keyTemp] = value
          }
          i++
        }
        dataObj.MAP = newMap
      }

      return dataObj
    }
  }
}

exports.TransformTx = function(tx) {
  return bmap.TransformTx(tx)
}
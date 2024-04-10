import { T } from '.'
import { NiceMerge, NiceOmit, NicePick } from './generics'
import { TObject } from './tsSchema'
import { mapEntries } from './utils'

export const tObject_omit = <
  TObj extends TObject,
  PropsToOmit extends (keyof TObj['properties'])[],
  NewProperties = NiceOmit<TObj['properties'], PropsToOmit[number]>,
  Out = NiceMerge<Omit<TObj, 'properties'>, { properties: NewProperties }>
>(
  obj: TObj,
  ...attrsName: PropsToOmit
) => {
  const propertiesCopy = { ...obj.properties }
  attrsName.forEach(key => {
    // @ts-expect-error
    delete propertiesCopy[key]
  })

  const out = { ...obj, properties: propertiesCopy } as Out
  return out
}

export const tObject_pick = <
  TObj extends TObject,
  PropsToPick extends (keyof TObj['properties'])[],
  NewProperties = NicePick<TObj['properties'], PropsToPick[number]>,
  Out = NiceMerge<Omit<TObj, 'properties'>, { properties: NewProperties }>
>(
  obj: TObj,
  ...attrsName: PropsToPick
) => {
  const propertiesCopy = {}
  attrsName.forEach(key => {
    // @ts-expect-error
    propertiesCopy[key] = obj.properties[key]
  })

  const out = { ...obj, properties: propertiesCopy } as Out
  return out
}

export const tObject_partial = <TObj extends TObject>(obj: TObj) => {
  const newTSchemaObj = {
    ...obj,
    properties: mapEntries(([k, v]) => [k, T.nullable(v)], obj.properties),
  }

  return newTSchemaObj as any as NiceMerge<
    Omit<TObj, 'properties'>,
    {
      properties: {
        [K in keyof TObj['properties']]: NiceMerge<
          Omit<TObj['properties'][K], 'required'>,
          { required: false }
        >
      }
    }
  >
}

export const tUtils = {
  tObject: {
    pick: tObject_pick,
    omit: tObject_omit,
    partial: tObject_partial,
  },
}

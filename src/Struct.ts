import {l} from "./Helpers";

type BinaryDataType = 'Int8'| 'UInt8' | 'Int16BE' | 'Int16LE' | 'UInt16BE' | 'UInt16LE' | 'Int32BE' | 'Int32LE' | 'UInt32BE' | 'UInt32LE';
type LargeDataType = 'BigInt64BE' | 'BigInt64LE' | 'BigUInt64BE' | 'BigUInt64LE';
type FractionDataType = 'DoubleBE' | 'DoubleLE' | 'FloatBE' | 'FloatLE';

export interface ItemsFormatter<I, R> {
    (data: I[]): R
}

interface Unpackable<R> {
    readonly size: number;
    unpack: (view: DataView, offset: number) => R;
}

export const Fractional: Record<FractionDataType, (() => Unpackable<number>)> = {
    DoubleBE: () => ({
        get size () {return 8},
        unpack: (view: DataView, offset: number) => view.getFloat64(offset, false)
    }),
    DoubleLE: () => ({
        get size () {return 8},
        unpack: (view: DataView, offset: number) => view.getFloat64(offset, true)
    }),
    FloatBE: () => ({
        get size () {return 4},
        unpack: (view: DataView, offset: number) => view.getFloat32(offset, false)
    }),
    FloatLE: () => ({
        get size () {return 4},
        unpack: (view: DataView, offset: number) => view.getFloat32(offset, true)
    }),
}

export const Large: Record<LargeDataType, (() => Unpackable<bigint>)> = {
    BigInt64BE: () => ({
        get size () {return  8},
        unpack: (view: DataView, offset: number) => view.getBigInt64(offset, false)
    }),
    BigInt64LE: () => ({
        get size () {return  8},
        unpack: (view: DataView, offset: number) => view.getBigInt64(offset, true)
    }),
    BigUInt64BE: () => ({
        get size () {return  8},
        unpack: (view: DataView, offset: number) => view.getBigUint64(offset, false)
    }),
    BigUInt64LE: () => ({
        get size () {return  8},
        unpack: (view: DataView, offset: number) => view.getBigUint64(offset, true)
    }),
}

export const Primitive: Record<BinaryDataType, (() => Unpackable<number>)> = {
    Int8: () => ({
        get size () {return 1},
        unpack: (view: DataView, offset: number) => view.getInt8(offset)
    }),
    UInt8: () => ({
        get size () {return 1},
        unpack: (view: DataView, offset: number) => view.getUint8(offset)
    }),
    Int16BE: () => ({
        get size () {return 2},
        unpack: (view: DataView, offset: number) => view.getInt16(offset, false)
    }),
    Int16LE: () => ({
        get size () {return 2},
        unpack: (view: DataView, offset: number) => view.getInt16(offset, true)
    }),
    UInt16BE: () => ({
        get size () {return 2},
        unpack: (view: DataView, offset: number) => view.getUint16(offset, false)
    }),
    UInt16LE: () => ({
        get size () {return 2},
        unpack: (view: DataView, offset: number) => view.getUint16(offset, true)
    }),
    Int32BE: () => ({
        get size () {return 4},
        unpack: (view: DataView, offset: number) => view.getInt32(offset, false)
    }),
    Int32LE: () => ({
        get size () {return 4},
        unpack: (view: DataView, offset: number) => view.getInt32(offset, true)
    }),
    UInt32BE: () => ({
        get size () {return 4},
        unpack: (view: DataView, offset: number) => view.getUint32(offset, false)
    }),
    UInt32LE: () => ({
        get size () {return 4},
        unpack: (view: DataView, offset: number) => view.getUint32(offset, true)
    }),
}

const dataref: unique symbol = Symbol();
const ignorable: unique symbol = Symbol();

type DataInjection<I> = {[dataref]: I[]};
export type SequenceItemLength<I> = (res: I & DataInjection<unknown>) => number;

const single: ItemsFormatter<any, any> = (data) => data[0];
const identity: ItemsFormatter<any, any> = (data) => data;

export class Struct<C extends {}> implements Unpackable<C> {
    get size () {
        return this.sequence
            .filter(({isOffset}) => !isOffset)//skip elements representing position
            .map(({unpackable, length}) => length(this.inject()) * unpackable.size)
            .reduce((acc, sz) => acc+sz, 0);
    }

    private sequence: {
        name: keyof C | symbol,
        unpackable: Unpackable<unknown>,
        length: SequenceItemLength<C>,
        formatter: ItemsFormatter<any, any>,
        isOffset?: boolean
    }[] = [];
    private res!: C;
    private readonly type: new () => C;
    private offset: number = 0;
    public static readonly one: SequenceItemLength<any> = l(1);
    public static readonly all: SequenceItemLength<any> = l(Number.MAX_SAFE_INTEGER);

    public constructor (type: new () => C = <any>Object) {
        this.type = type;
    }

    public single<A, F extends C[keyof C]> (as: keyof C, unpackable: Unpackable<A>, formatter: ItemsFormatter<A, F> = single): Struct<C> {
        this.sequence.push({name: as, unpackable, length: Struct.one, formatter});
        return this;
    }

    public array<A, F extends C[keyof C]> (as: keyof C, unpackable: Unpackable<A>, length: SequenceItemLength<C>, formatter: ItemsFormatter<A, F> = identity): Struct<C> {
        this.sequence.push({name: as, unpackable, length, formatter});
        return this;
    }

    public offsetOf<A, F extends C[keyof C] & number> (as: keyof C, unpackable: Unpackable<A>, lookup: (by: A) => boolean): Struct<C> {
        this.sequence.push({name: as, unpackable, length: (payload: C & DataInjection<unknown>) => {
                let raw: A[] = <A[]>payload[dataref];
                if (raw.length === 0) return Struct.all(payload);
                if (lookup(raw[raw.length-1])) {
                    this.seek(() => this.tell()-raw.length);//rewind
                    return 0;
                }
                return Struct.all(payload);
            }, formatter: (r: unknown[]) => r.length-1, isOffset: true});
        return this;
    }

    public goto (offset: SequenceItemLength<C>): Struct<C> {
        this.sequence.push({name: ignorable, unpackable: {
                get size () {return 0},
                unpack: () => this.seek(offset)
            }, length: Struct.one, formatter: single});
        return this;
    }

    public seek (offset: SequenceItemLength<C>): void {
        this.offset = offset(this.inject());
    }

    public tell (): number {
        return this.offset;
    }

    private inject<A> (payload: A[] = []): C & DataInjection<A> {
        return {...this.res, [dataref]: payload}
    }

    private isKeyOfC(name: keyof C | symbol): name is keyof C{
        return name !== ignorable;
    }

    public unpack (view: DataView, offset: number = 0): C {
        this.offset = offset;
        this.res = new this.type();
        for (let {name, unpackable, length, formatter} of this.sequence) {
            let data: ReturnType<typeof unpackable.unpack>[] = [];
            for (let i = 0, l = view.byteLength; i < length(this.inject(data)) && this.offset < l; i++) {
                data[i] = unpackable.unpack(view, this.offset);
                this.offset += unpackable.size;
            }
            this.isKeyOfC(name) && (this.res[name] = formatter(data));
        }
        return this.res;
    }

}

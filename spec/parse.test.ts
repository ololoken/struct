import {Struct, Primitive, ItemsFormatter} from '../src/Struct'
import {StringFormatter, la, l} from '../src/Helpers.node'
import {readFileSync} from 'fs';
import {TextDecoder} from 'util';

describe('Test struct', () => {

    const utf8String = '—simple utf-8©іѳ≈˚§€²³$‰←∞\0';
    const encryptedFile = readFileSync(`${__dirname}/resources/471-strings.dat`);
    const [Byte, Char] = [Primitive.UInt8(), Primitive.Int8()];

    it('read null terminated string', () => {
        let buffer = Buffer.alloc(150, 254);

        let bytesWritten = buffer.write(utf8String);
        let data = new DataView(buffer.buffer);

        let txtStruct = new Struct<{eol: number, text: string}>()
            //lookup
            .offsetOf('eol', Primitive.Int8(), (n) => n === 0)
            //do some shifts
            .goto(({eol}) => eol)
            .goto(l(0))
            //read and decode
            .array('text', Char, la('eol'), StringFormatter());

        let res = txtStruct.unpack(data);
        expect(res.eol).toBe(bytesWritten-1);
        expect(res.text).toBe("—simple utf-8©іѳ≈˚§€²³$‰←∞");
    });

    it('read encrypted file', () =>  {
        let PascalDecryptFormatter = (key: number[]): ItemsFormatter<number, string> => (data) => {
            for (let i = data.length-1, l = key.length; i >= 0; --i) {
                data[i] ^= key[i%l];
                data[i] ^= data[i-1];
            }
            return new TextDecoder('ascii').decode(new Int8Array(data), {stream: false});
        }

        interface TextChunk {
            length: number,
            data: string
        }

        let textStruct = new Struct<{strings: TextChunk[]}>()
            .array('strings', new Struct<TextChunk>()
                .single('length', Byte)
                .array('data', Char, la('length'), PascalDecryptFormatter([204, 129, 63, 255, 71, 19, 25, 62, 1, 99])),
                Struct.all)

        let {strings} = textStruct.unpack(new DataView(encryptedFile.buffer));

        expect(strings.length).toBe(471);
        let content = strings.map(({data}) => data).join('');
        expect(content).toContain(']?[ 04 010 011 013 017   (No cubes)');
    })

});
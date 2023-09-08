import { OurFile, PendingItem } from '../home';

const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
  const byteCharacters = atob(b64Data);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);

    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  return new Blob(byteArrays, { type: contentType });
};

export const mockThumbs = (): PendingItem[] => {
  const imgA =
    'iVBORw0KGgoAAAANSUhEUgAAAOIAAAC9AgMAAADTpklmAAAADFBMVEUeIB4nKSZLTUteYF1cE1F2AAACzElEQVRo3u3aMZabMBAG4B8ewYWLkPeSio' +
    'Ij+Ao6wjZJkyJH8BHMEShyBFducgRfwUegcLOpUpD3sF9QUhhjCQTMjL32Zh/qv5WFpJnZAWAa06jHu8/8oQAA8V/+2AEA3kulNxfPKZfxJN+a1B' +
    'vOMGUVMe6WtzUl61pOcpIAolvOSYzuXeltSddLOyTtYlbiOSv5nNEtf+0kX7fUG6E8PuGLTH4HsJTIowIQSuQ+ADy1FMh0sEgakPpUDIZ8WV6SJF' +
    'Pu6wC3ZMuslgu2TGsZc2X9gIAZW54DeciVTZ7wufLQ1C5cWZ4huLIwM9bd5Yopfz1AFjeQ93u2zUmIpBIfxCf+cm4185b5bNm92dVWGk3KlTSCFQ' +
    'uazDtRs0iIkTpqR+p8TswOnQC2C6UZKfOJMgcAMwumHlEeACA09lCZh38w22cAvhr1hjKz01iFYU6prew0XNX83PywVuYlskqqsh40R5bW5nJkYW' +
    'UnpvRkMreiGUfurIvDkZl1WTkyBZCIpLJuDlfOJFLbIZQhKzu2MOQfOz0xZAkAwUogCzv63kWeIncikK1eGUNmdvhlyNTOiQyp7DxMl1ouW1UDXZ' +
    '4rDr48QFm1HF0WrSqQLI+qlfypUp/rDbZcN/VjwpPPqpExSx4vsDm4JHlaZGQXcyS5NvttPkP+VkJ5VHaLmSwvO2mX9eNyDaF87rQkVzSpVafNvq' +
    'DJQwChzLvt+4Qms27rNSZJrbpyTpKlo907I8m9Q/okmUqlhuOliUeRB2dfmyJzp1wRZCqV2t2FX47L0i2Tcbl3y3hcupdZb+iQdB3aS1QYkj3LRL' +
    'Ag/UeHvjM/JLM+GdL6mn0LHe9rut7mfKP1Nbvj45zWT+jZUUIPo2ehhE5hz4665OkF09PQS6tPzjdQ/9XbveCF54xexzo9sYweIB/whORfGUxfcE' +
    'zy/jK6bk75l2RXjKv/wDTewPgHwR/33fPfU0YAAAAASUVORK5CYII=';

  const mkFile = (img: string, name: string): OurFile => {
    const f: OurFile = b64toBlob(img, 'image/png');
    f.name = name;
    return f;
  };

  return [
    { state: 'queued', ctx: 'dropped', file: mkFile(imgA, 'queued.png') },
    { state: 'starting', ctx: 'pasted', file: mkFile(imgA, 'starting.png') },
    {
      state: 'uploading',
      ctx: 'picked',
      file: mkFile(imgA, 'uploading-nan.png'),
      progress: NaN,
    },
    {
      state: 'uploading',
      ctx: 'picked',
      file: mkFile(imgA, 'uploading-0.png'),
      progress: 0,
    },
    {
      state: 'uploading',
      ctx: 'picked',
      file: mkFile(imgA, 'uploading-20.png'),
      progress: 20 / 100,
    },
    {
      state: 'uploading',
      ctx: 'picked',
      file: mkFile(imgA, 'uploading-99.png'),
      progress: 99 / 100,
    },
    {
      state: 'uploading',
      ctx: 'picked',
      file: mkFile(imgA, 'uploading-100.png'),
      progress: 100 / 100,
    },
    {
      state: 'error',
      ctx: 'picked',
      file: mkFile(imgA, 'error.png'),
      error: 'something went wrong',
    },
  ];
};

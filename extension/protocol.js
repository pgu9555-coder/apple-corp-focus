export function crc16(text) {
  let crc=0xffff;
  for(const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for(let i=0;i<8;i++) crc=((crc&0x8000)?(crc<<1)^0x1021:crc<<1)&0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
export function encodeFrame(sequence,command,session='0',value='0') {
  const fields=['F1',String(sequence),command,session,String(value)];
  if(!Number.isInteger(sequence)||sequence<1||sequence>2147483647||
     !/^[A-Z_]{2,20}$/.test(command)||! /^(0|[a-f0-9]{32})$/.test(session)||
     !/^[A-Za-z0-9_]{1,32}$/.test(String(value)))throw new Error('Invalid serial frame.');
  const body=fields.join('|'); return `${body}|${crc16(body)}\n`;
}
export function decodeFrame(line) {
  const text=line.replace(/\r?\n$/,'');
  if(text.length>150)throw new Error('Serial frame too long.');
  const fields=text.split('|');
  if(fields.length!==6||fields[0]!=='F1'||!/^[0-9]+$/.test(fields[1])||
    !/^(ACK|ERR)$/.test(fields[2])||!/^(0|[a-f0-9]{32})$/.test(fields[3])||
    !/^[A-Z0-9_]{1,32}$/.test(fields[4])||crc16(fields.slice(0,5).join('|'))!==fields[5])throw new Error('Invalid serial response or checksum.');
  const sequence=Number(fields[1]);
  if(!Number.isSafeInteger(sequence)||sequence<1||sequence>2147483647)throw new Error('Invalid response sequence.');
  return {sequence,type:fields[2],session:fields[3],value:fields[4]};
}

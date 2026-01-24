declare module 'noir-react-native' {
  export function generateNoirProof(
    circuitPath: string,
    srsPath: string,
    inputs: string,
    onChain: boolean,
    verificationKey: string,
    lowMemoryMode: boolean
  ): Promise<{ proof: string; publicInputs?: string[] }>;

  export function verifyNoirProof(
    circuitPath: string,
    proof: string,
    onChain: boolean,
    verificationKey: string,
    lowMemoryMode: boolean
  ): Promise<boolean>;

  export function getNoirVerificationKey(
    circuitPath: string,
    srsPath: string,
    onChain: boolean,
    lowMemoryMode: boolean
  ): Promise<string>;
}

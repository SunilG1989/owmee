declare module 'react-native-razorpay' {
  export type RazorpayCheckoutOptions = {
    key: string;
    amount: string | number;
    currency: string;
    name: string;
    description?: string;
    order_id?: string;
    prefill?: {
      contact?: string;
      email?: string;
      name?: string;
    };
    timeout?: number;
    retry?: {
      enabled?: boolean;
      max_count?: number;
    };
    theme?: {
      color?: string;
    };
  };

  export type RazorpayCheckoutResult = {
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  };

  type RazorpayCheckoutStatic = {
    open(options: RazorpayCheckoutOptions): Promise<RazorpayCheckoutResult>;
  };

  const RazorpayCheckout: RazorpayCheckoutStatic;
  export default RazorpayCheckout;
}

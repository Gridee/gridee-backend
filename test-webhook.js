fetch('http://localhost:3000/api/payments/webhook', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'verif-hash': 'gridee_webhook_secret_2026'
  },
  body: JSON.stringify({
    tx_ref: 'GRD-1777936046433-LL2M6D',
    status: 'successful',
    amount: 15000
  })
}).then(res => res.json()).then(console.log).catch(console.error);

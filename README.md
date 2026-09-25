# Waybill Wall

Pin a tracking number, guess the shipper, and share the slip. No carrier login.

Carriers: USPS, UPS, FedEx, DHL, HDX, OnTrac.

The wall stays in this browser (`localStorage`) and in the share link (`#w=`). It keeps the numbers, shipper, and captions you type. It does not sign into a carrier account.

## FedEx live status (optional)

FedEx blocks anonymous tracking calls from the app host, so a FedEx slip links out to [FedEx tracking](https://www.fedex.com/fedextrack/) for that number. The app runs with no FedEx credentials.

To show city-level status on the slip, set these on the server:

| Variable           | Required | Purpose                                                                         |
| ------------------ | -------- | ------------------------------------------------------------------------------- |
| `FEDEX_API_KEY`    | no       | Track API client id (API key)                                                   |
| `FEDEX_SECRET_KEY` | no       | Track API secret key                                                            |
| `FEDEX_API_BASE`   | no       | Defaults to `https://apis.fedex.com`. Sandbox: `https://apis-sandbox.fedex.com` |

If either key is missing, or the Track API does not answer, the slip falls back to the FedEx link.

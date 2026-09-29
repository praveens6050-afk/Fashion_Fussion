// Synthetic data only. The client rejects mutation methods by omission.
(function () {
  const account = location.pathname.includes('account');
  const user = { id:'fixture-user', email:'customer@example.test' };
  const product = { id:11, name:'Ganesha Pooja Thali Set – Traditional Religious Decor for Festivals', category:'Pooja & Religious', price:334, gst_rate:18, is_active:true, description:'Decorative pooja thali set for home and festivals.' };
  const address = { id:1, label:'Home', full_name:'Test Customer', phone:'0000000000', address_line1:'123 Example Street', city:'Jaipur', state:'Rajasthan', postal_code:'302020', is_default:true };
  const data = {
    products:[product, {...product,id:12,name:'Second catalogue product for grid wrapping'}],
    profiles:[{id:user.id,full_name:'Test Customer',phone:'0000000000'}],
    orders:[{id:1,display_order_id:'OD20260928000000000001',created_at:'2026-09-28',status:'cancelled',payment_method:'cod',total_amount:394.12,items:[{...product,qty:1}]}],
    customer_addresses:[address], return_requests:[], business_profiles:[], bulk_quotes:[]
  };
  window.supabaseClient = {
    auth:{getUser:async()=>({data:{user}}),getSession:async()=>({data:{session:account?{user}:null}})},
    from(table) {
      let rows = data[table] || [];
      const query = {
        select(){return this;}, eq(){return this;}, order(){return this;}, limit(){return this;},
        in(key,values){rows=rows.filter(r=>values.includes(r[key]));return this;},
        maybeSingle:async()=>({data:rows[0]||null,error:null}),
        then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}
      };
      return query;
    }
  };
  window.ffSupabaseReady=Promise.resolve(window.supabaseClient);
  if(location.pathname.includes('cart')) {
    localStorage.setItem('fashion_fussion_cart',JSON.stringify({11:2}));
    localStorage.removeItem('fashion_fussion_cart_lines_v2');
  }
})();
